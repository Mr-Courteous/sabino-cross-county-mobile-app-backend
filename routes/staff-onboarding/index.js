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
// managementRouter -> everything the school owner (or an existing
//                     admin) uses to create/list/deactivate/delete
//                     other admin accounts. Requires a school-type
//                     token on every route.
// ─────────────────────────────────────────────────────────────
module.exports = {
  authRouter: require('./auth'),
  managementRouter: require('./management'),
};
