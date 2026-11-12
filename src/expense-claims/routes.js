const ROLES = new Set(['applicant', 'approver']);
// repository.summarizeByMonth が初期化する 3 状態と同じ集合
const CLAIM_STATUSES = new Set(['pending', 'approved', 'rejected']);
const DESCRIPTION_MAX_LENGTH = 200;
const AMOUNT_MAX = 1_000_000;
const REJECT_REASON_MAX_LENGTH = 500;
// description の上限と同じ値だが、意味が異なるため別に定義する
const RESUBMIT_NOTE_MAX_LENGTH = 200;

function sendError(reply, statusCode, error, message) {
  return reply.code(statusCode).send({ statusCode, error, message });
}

// 識別はスキーマ検証より前に行う（チェック順 401 → 403 → 400 を守るため）
function requireRole(role) {
  return async function checkRole(request, reply) {
    if (request.user.role !== role) {
      return sendError(reply, 403, 'Forbidden', `この操作には ${role} ロールが必要です`);
    }
  };
}

function isRealDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

function parseId(raw) {
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : null;
}

// スキーマで表せない申請内容の検証（作成と出し直しで共有する）。
// 正規化した値か、400 で返すメッセージのどちらかを返す
function validateClaimContent({ date, amount, description: rawDescription }) {
  if (!isRealDate(date)) {
    return { error: 'date は実在する日付でなければなりません' };
  }
  const description = rawDescription.trim();
  const length = [...description].length;
  if (length < 1 || length > DESCRIPTION_MAX_LENGTH) {
    return {
      error: `description は前後の空白を除いて 1〜${DESCRIPTION_MAX_LENGTH} 文字でなければなりません`,
    };
  }
  return { value: { date, amount, description } };
}

const createBodySchema = {
  type: 'object',
  required: ['date', 'amount', 'description'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    amount: { type: 'integer', minimum: 1, maximum: AMOUNT_MAX },
    description: { type: 'string' },
  },
};

// date・amount・description の規則は createBodySchema の定義をそのまま使う
const resubmitBodySchema = {
  ...createBodySchema,
  required: [...createBodySchema.required, 'resubmitNote'],
  properties: {
    ...createBodySchema.properties,
    resubmitNote: { type: 'string' },
  },
};

const rejectBodySchema = {
  type: 'object',
  required: ['reason'],
  properties: {
    reason: { type: 'string' },
  },
};

const summaryQuerySchema = {
  type: 'object',
  required: ['month'],
  properties: {
    month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
  },
};

export async function expenseClaimsRoutes(app, { repository }) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request, reply) => {
    const id = request.headers['x-user-id'];
    const role = request.headers['x-user-role'];
    if (typeof id !== 'string' || id.trim() === '' || !ROLES.has(role)) {
      return sendError(
        reply,
        401,
        'Unauthorized',
        'X-User-Id と X-User-Role（applicant / approver）ヘッダーが必要です',
      );
    }
    request.user = { id, role };
  });

  app.post(
    '/expense-claims',
    { preValidation: requireRole('applicant'), schema: { body: createBodySchema } },
    async (request, reply) => {
      const content = validateClaimContent(request.body);
      if (content.error) {
        return sendError(reply, 400, 'Bad Request', content.error);
      }

      const claim = repository.create({ applicantId: request.user.id, ...content.value });
      return reply.code(201).send(claim);
    },
  );

  // status はスキーマの enum でなくここで検証する（message を日本語にするため）。
  // 繰り返し指定は配列になるので、文字列であることも確かめる
  app.get('/expense-claims', async (request, reply) => {
    const { id, role } = request.user;
    const { status } = request.query;
    if (status !== undefined && !(typeof status === 'string' && CLAIM_STATUSES.has(status))) {
      return sendError(
        reply,
        400,
        'Bad Request',
        'status は pending・approved・rejected のいずれか 1 つでなければなりません',
      );
    }
    return repository.list({ applicantId: role === 'applicant' ? id : undefined, status });
  });

  // preValidation はスキーマ検証より先に動くため、申請者には month の値に関わらず 403 を返す
  app.get(
    '/expense-claims/summary',
    { preValidation: requireRole('approver'), schema: { querystring: summaryQuerySchema } },
    async (request) => repository.summarizeByMonth(request.query.month),
  );

  // ID の解析と decide の結果（404 / 409）の応答への変換をまとめる
  function decideAndReply(request, reply, status, rejectReason = null) {
    const id = parseId(request.params.id);
    if (id === null) {
      return sendError(reply, 404, 'Not Found', '申請が見つかりません');
    }
    const outcome = repository.decide(id, status, request.user.id, rejectReason);
    if (outcome.result === 'not_found') {
      return sendError(reply, 404, 'Not Found', '申請が見つかりません');
    }
    if (outcome.result === 'conflict') {
      return sendError(
        reply,
        409,
        'Conflict',
        `申請はすでに ${outcome.claim.status} のため変更できません`,
      );
    }
    return outcome.claim;
  }

  app.post(
    '/expense-claims/:id/approve',
    { preValidation: requireRole('approver') },
    async (request, reply) => decideAndReply(request, reply, 'approved'),
  );

  // 理由の検証は申請の存在確認（decide）より先に行う（仕様「差戻しの検証の順序」）
  app.post(
    '/expense-claims/:id/reject',
    { preValidation: requireRole('approver'), schema: { body: rejectBodySchema } },
    async (request, reply) => {
      const reason = request.body.reason.trim();
      const length = [...reason].length;
      if (length < 1 || length > REJECT_REASON_MAX_LENGTH) {
        return sendError(
          reply,
          400,
          'Bad Request',
          `reason は前後の空白を除いて 1〜${REJECT_REASON_MAX_LENGTH} 文字でなければなりません`,
        );
      }
      return decideAndReply(request, reply, 'rejected', reason);
    },
  );

  // 本文の検証は元の申請の存在確認（resubmit）より先に行う（仕様「出し直しの内容の検証」）
  app.post(
    '/expense-claims/:id/resubmit',
    { preValidation: requireRole('applicant'), schema: { body: resubmitBodySchema } },
    async (request, reply) => {
      const content = validateClaimContent(request.body);
      if (content.error) {
        return sendError(reply, 400, 'Bad Request', content.error);
      }
      const resubmitNote = request.body.resubmitNote.trim();
      const noteLength = [...resubmitNote].length;
      if (noteLength < 1 || noteLength > RESUBMIT_NOTE_MAX_LENGTH) {
        return sendError(
          reply,
          400,
          'Bad Request',
          `resubmitNote は前後の空白を除いて 1〜${RESUBMIT_NOTE_MAX_LENGTH} 文字でなければなりません`,
        );
      }

      const id = parseId(request.params.id);
      if (id === null) {
        return sendError(reply, 404, 'Not Found', '申請が見つかりません');
      }
      const outcome = repository.resubmit(id, request.user.id, {
        ...content.value,
        resubmitNote,
      });
      if (outcome.result === 'not_found') {
        return sendError(reply, 404, 'Not Found', '申請が見つかりません');
      }
      if (outcome.result === 'conflict') {
        const message =
          outcome.reason === 'already_resubmitted'
            ? 'この申請はすでに出し直されています'
            : `申請はすでに ${outcome.claim.status} のため変更できません`;
        return sendError(reply, 409, 'Conflict', message);
      }
      return reply.code(201).send(outcome.claim);
    },
  );
}
