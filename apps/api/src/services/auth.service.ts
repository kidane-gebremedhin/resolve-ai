import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Organization, User, Membership } from "../models/index.js";
import { signAccessToken, signRefreshToken } from "../utils/jwt.js";
import { ConflictError, UnauthorizedError } from "../utils/errors.js";

const BCRYPT_COST = 12;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}) {
  const existing = await User.findOne({ email: input.email });
  if (existing) throw new ConflictError("Email already in use.");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  const baseSlug = slugify(input.organizationName) || `org-${Date.now()}`;
  let slug = baseSlug;
  let attempt = 0;
  while (await Organization.exists({ slug })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const user = await User.create({
    email: input.email,
    name: input.name,
    provider: "credentials",
    passwordHash,
    role: "user",
  });

  const org = await Organization.create({
    name: input.organizationName,
    slug,
    plan: "free",
  });

  await Membership.create({
    userId: user._id,
    organizationId: org._id,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });

  return issueTokens(user, org._id.toString(), "owner");
}

/**
 * Returns the user's active membership, creating an Organization + owner
 * Membership on first call if none exists. Used by SSO sign-in (Google) so
 * that JWTs always carry an `organizationId` — without it every protected
 * route 403s with "No organization context in token." (See spec 12 §1.1.)
 */
export async function ensureMembershipForUser(user: {
  _id: mongoose.Types.ObjectId | string;
  email: string;
  name: string;
}) {
  const existing = await Membership.findOne({
    userId: user._id,
    status: "active",
  }).sort({ createdAt: 1 });
  if (existing) return existing;

  const baseSlug =
    slugify(user.name) ||
    slugify(user.email.split("@")[0] ?? "") ||
    `org-${Date.now()}`;
  let slug = baseSlug;
  let attempt = 0;
  while (await Organization.exists({ slug })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const org = await Organization.create({
    name: `${user.name}'s workspace`,
    slug,
    plan: "free",
  });

  return Membership.create({
    userId: user._id,
    organizationId: org._id,
    role: "owner",
    status: "active",
    acceptedAt: new Date(),
  });
}

export async function loginWithCredentials(email: string, password: string) {
  const user = await User.findOne({ email });
  if (!user || !user.passwordHash) throw new UnauthorizedError("Invalid email or password.");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid email or password.");
  user.lastLoginAt = new Date();
  await user.save();

  const membership = await Membership.findOne({ userId: user._id, status: "active" }).sort({
    createdAt: 1,
  });
  return issueTokens(
    user,
    membership?.organizationId?.toString(),
    membership?.role as "owner" | "admin" | "agent" | "viewer" | undefined,
  );
}

function issueTokens(
  user: { _id: mongoose.Types.ObjectId | string; email: string; name: string; role: string },
  organizationId: string | undefined,
  membershipRole: "owner" | "admin" | "agent" | "viewer" | undefined,
) {
  const userId = user._id.toString();
  const accessToken = signAccessToken({
    userId,
    organizationId,
    role: user.role as "user" | "platform_admin",
    membershipRole,
  });
  const refreshToken = signRefreshToken({ userId });
  return {
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId,
      membershipRole,
    },
    accessToken,
    refreshToken,
    expiresIn: 900,
  };
}
