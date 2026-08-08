// ─────────────────────────────────────────────────────────────
// middleware/auditLog.js
//
// Generic "who did what" logging for any route, reusing the same
// staff_audit_logs table the Staff Onboarding module already writes
// to (see routes/staff-onboarding/db.js). This does NOT touch any
// existing route handler's logic — it's inserted as an extra
// middleware in the chain, ahead of the handler, and only observes
// the response the handler already produces.
//
// Usage (add ONE line to an existing route, nothing else changes):
//
//   const { auditRoute } = require('../middleware/auditLog');
//
//   router.post('/', authMiddleware.authenticateToken, authMiddleware.requireSchool, checkSubscription,
//     auditRoute('student.created', (req, body) => ({ type: 'student', id: body?.data?.student?.id })),
//     async (req, res) => { ...unchanged... });
//
// `getTarget(req, body)` runs AFTER the handler has responded, so it
// can read the created/updated record's id out of the response body,
// or fall back to req.params for updates/deletes. Return null/undefined
// safely — a target is optional.
// ─────────────────────────────────────────────────────────────
const { logGenericAudit } = require('../routes/staff-onboarding/db');

function auditRoute(action, getTarget) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      // Fire-and-forget — never let audit logging delay or break the
      // actual response. Only log responses the handler itself marked
      // successful; validation errors, 4xx/5xx, etc. are skipped.
      if (res.statusCode < 400 && body && body.success !== false) {
        try {
          const schoolId = req.user?.schoolId;
          const isAdmin = req.user?.role === 'admin';
          let target = {};
          try {
            target = (typeof getTarget === 'function' ? getTarget(req, body) : null) || {};
          } catch (_) {
            // A misbehaving getTarget should never break the response.
          }

          if (schoolId) {
            logGenericAudit({
              schoolId,
              actorType: isAdmin ? 'admin' : 'owner',
              actorStaffId: isAdmin ? (req.user?.staffId || null) : null,
              action,
              targetType: target.type || null,
              targetId: target.id || null,
              details: target.details || null,
            });
          }
        } catch (err) {
          console.error('⚠️ [auditLog] Failed to queue audit entry:', err.message);
        }
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = { auditRoute };
