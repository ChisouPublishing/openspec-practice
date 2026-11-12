const ROLES = new Set(['applicant', 'approver']);
const DESCRIPTION_MAX_LENGTH = 200;

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

const createBodySchema = {
  type: 'object',
  required: ['date', 'amount', 'description'],
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    amount: { type: 'integer', minimum: 1 },
    description: { type: 'string' },
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
      const { date, amount } = request.body;
      const description = request.body.description.trim();

      if (!isRealDate(date)) {
        return sendError(reply, 400, 'Bad Request', 'date は実在する日付でなければなりません');
      }
      const length = [...description].length;
      if (length < 1 || length > DESCRIPTION_MAX_LENGTH) {
        return sendError(
          reply,
          400,
          'Bad Request',
          `description は前後の空白を除いて 1〜${DESCRIPTION_MAX_LENGTH} 文字でなければなりません`,
        );
      }

      const claim = repository.create({
        applicantId: request.user.id,
        date,
        amount,
        description,
      });
      return reply.code(201).send(claim);
    },
  );

  app.get('/expense-claims', async (request) => {
    const { id, role } = request.user;
    return repository.list(role === 'applicant' ? { applicantId: id } : {});
  });

  for (const [action, status] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ]) {
    app.post(
      `/expense-claims/:id/${action}`,
      { preValidation: requireRole('approver') },
      async (request, reply) => {
        const id = parseId(request.params.id);
        if (id === null) {
          return sendError(reply, 404, 'Not Found', '申請が見つかりません');
        }
        const outcome = repository.decide(id, status, request.user.id);
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
      },
    );
  }
}
