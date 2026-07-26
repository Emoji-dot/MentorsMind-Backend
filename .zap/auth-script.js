/**
 * ZAP HTTP Sender script — JWT bearer auth injection (issue #785).
 *
 * MentorMinds uses stateless JWT bearer auth rather than cookie/session
 * auth, so ZAP's built-in "form-based" / "script-based" authentication
 * methods (which model a login flow producing a session cookie) don't fit.
 * Instead this is loaded as an HTTP Sender script: it stamps every outgoing
 * request to the scan target with `Authorization: Bearer <token>`, letting
 * the baseline/full scan crawl and test authenticated routes.
 *
 * The token is obtained by the CI job *before* the scan starts (register +
 * login a disposable test user against the running instance) and passed in
 * via the ZAP_AUTH_TOKEN environment variable — never hard-code a token
 * here.
 *
 * Install: Script Console > HTTP Sender > Load this file, or pass via
 *   zap-baseline.py -z "-config httpsender.script=/zap/wrk/.zap/auth-script.js"
 * (exact wiring depends on the zaproxy/action-baseline version — see
 * docs/SECURITY_SCANNING_RUNBOOK.md for the current CI invocation.)
 */

function sendingRequest(msg, initiator, helper) {
  var System = Java.type('java.lang.System');
  var token = System.getenv('ZAP_AUTH_TOKEN');

  if (token) {
    msg.getRequestHeader().setHeader('Authorization', 'Bearer ' + token);
  }
}

function responseReceived(msg, initiator, helper) {
  // No-op — nothing to inspect on the response for auth purposes.
}
