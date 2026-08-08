// ─────────────────────────────────────────────────────────────
// routes/staff-onboarding/index.js
//
// Staff Onboarding module (Part 3 of the Sabino Edu addendum).
// Two routers, mounted separately in index.js:
//
//   app.use('/api/staff-auth', require('./routes/staff-onboarding').authRouter);
//   app.use('/api/staff',      require('./routes/staff-onboarding').managementRouter);
//
// authRouter       -> login, forgot/reset password, forced first-login
//                     password change, invite-code redemption. Mostly
//                     public, self-service.
// managementRouter -> everything for managing OTHER admin accounts.
//                     Reads (list admins, audit log) are open to both
//                     owner and admin. Writes (create, invite, revoke
//                     invite, deactivate, reactivate, delete) are
//                     OWNER ONLY — see requireOwner guards in
//                     ./management.js.
// ─────────────────────────────────────────────────────────────
module.exports = {
  authRouter: require('./auth'),
  managementRouter: require('./management'),
};
