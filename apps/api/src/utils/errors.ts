export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Forbidden") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "validation_error", message, details);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super(409, "conflict", message);
  }
}

// Password was correct, but the account has 2FA enabled and no code was
// supplied. Deliberately distinct from UnauthorizedError: the client needs to
// tell "wrong password" (show an error) apart from "now ask for the code"
// (show the second field). It is only ever reachable AFTER the password check
// passes, so it reveals nothing to someone who does not already hold valid
// credentials.
export class TotpRequiredError extends ApiError {
  constructor(message = "A two-factor code is required.") {
    super(401, "totp_required", message);
  }
}

// 2FA code supplied but wrong, expired, or an already-used recovery code.
export class InvalidTotpError extends ApiError {
  constructor(message = "That two-factor code is not valid.") {
    super(401, "invalid_totp", message);
  }
}
