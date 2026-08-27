// TOTP verification, with the clock-skew tolerance RFC 6238 asks for.
//
// A TOTP code is valid for one 30-second window. Verifying against ONLY the
// current window — which is otplib's default and what this codebase did — means
// a code is rejected whenever any of the following is true:
//
//   - the user's device clock differs from the server's by a second or two,
//     which is extremely common on phones that have drifted;
//   - the user types the code near the end of its window and the request
//     arrives after the boundary;
//   - the request spends a moment in a queue, a proxy, or a slow network.
//
// The user experiences all three as "my authenticator app is wrong", retries,
// and hits the login rate limit. RFC 6238 §5.2 explicitly calls for accepting
// adjacent time steps for exactly this reason, and every mainstream
// implementation allows at least ±1.
//
// SECURITY: widening to ±1 step means 3 codes out of 1,000,000 are valid at any
// instant instead of 1. Against `loginLimiter` (10 attempts per 15 minutes) that
// moves the odds of a successful guess from negligible to negligible, and the
// alternative — locking out users with slightly wrong clocks — is a real and
// constant cost paid to avoid a theoretical one.
import { verify as verifyOtp } from "otplib";

/**
 * Seconds of clock skew accepted either side of the current window.
 *
 * 30 = exactly one time step. Deliberately not larger: each additional step
 * widens the guess surface for no further usability gain, since a device more
 * than a minute out of sync has a clock problem the user needs to fix anyway.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

/**
 * Verify a TOTP code, tolerating one time step of clock skew.
 *
 * Every TOTP check in the codebase must go through this rather than calling
 * `otplib.verify` directly: the tolerance is a security-relevant decision, and
 * a second call site that quietly omits it would be a login bug nobody notices
 * until users complain.
 */
export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  const result = await verifyOtp({
    secret,
    token,
    epochTolerance: EPOCH_TOLERANCE_SECONDS,
  });
  return Boolean(result?.valid);
}
