// Map ApiError codes to localized strings.

export function mapApiError(err, t) {
  if (!err) return null;
  switch (err.code) {
    case "invalid_credentials":
      return t("error.invalid_credentials");
    case "conflict":
      return t("error.conflict");
    case "bad_request":
      return t("error.bad_request", { message: err.message });
    case "feature_disabled":
      return t("error.feature_disabled");
    case "not_implemented":
      return t("error.not_implemented");
    case "network":
      return t("error.network");
    case "http_429":
      return t("error.rate_limited");
    default:
      return t("error.unknown");
  }
}
