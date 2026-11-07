/** Allowlisted failed-run diagnostics received from Mimo.
 * All provider bodies, URLs, tokens, headers and exception messages are
 * untrusted and must NEVER be included in Firebase/Firestore/browser output.
 */
export const SAFE_RUN_CODES=Object.freeze({
  provider_invalid_request:"Provider rejected the extraction request (HTTP 400).",
  provider_authorization_rejected:"Provider credentials or permissions were rejected.",
  provider_model_or_endpoint_unavailable:"Configured provider model or endpoint is unavailable.",
  provider_request_timeout_unknown:"Provider request timed out; outcome may be uncertain.",
  provider_payload_too_large:"Provider rejected the request as too large.",
  provider_unprocessable_request:"Provider could not process the request.",
  provider_rate_limited:"Provider rate limit reached; do not resubmit this paid job blindly.",
  provider_daily_quota_exhausted:"OpenRouter free daily request quota exhausted; retry after quota reset, not by re-uploading.",
  provider_request_rejected:"Provider rejected the extraction request.",
  provider_server_response_unknown:"Provider returned a server error; charges may be uncertain.",
  provider_unexpected_status:"Provider returned an unexpected response status.",
  provider_timeout_outcome_unknown:"Provider timed out; charges may be uncertain.",
  provider_transport_outcome_unknown:"Provider connection failed; charges may be uncertain.",
  execution_invalid_response_or_contract:"Mimo received an invalid execution response.",
  execution_internal_error:"Mimo encountered an internal execution error.",
});

/** Compatible with Mimo prior to P0 diagnostic rollout (empty result). */
export function safeMimoRunDiagnostic(output) {
  // Historical Mimo runs had a stable reason but no machine-readable code.
  // Match ONLY this exact server-defined string; never show raw provider text.
  const code=output?.error_code||
    (output?.status==="waiting_for_review"&&
      output?.reason==="RPM deferral requires operator review"
      ?"provider_rate_limited":null);
  if(typeof code!=="string"||!Object.hasOwn(SAFE_RUN_CODES,code))return {};
  const status=output?.upstream_http_status;
  const result={diagnosticCode:code};
  if(Number.isInteger(status)&&status>=400&&status<=599)
    result.diagnosticHttpStatus=status;
  return result;
}

export function describeMimoRunDiagnostic(diagnosticCode,diagnosticHttpStatus) {
  const text=SAFE_RUN_CODES[diagnosticCode]||"";
  if(!text)return "";
  return Number.isInteger(diagnosticHttpStatus)&&diagnosticHttpStatus>=400&&diagnosticHttpStatus<=599
    ?text+" (HTTP "+diagnosticHttpStatus+")":text;
}
