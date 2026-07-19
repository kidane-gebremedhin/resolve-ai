declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        organizationId?: string;
        role: "user" | "platform_admin";
        membershipRole?: "owner" | "admin" | "agent" | "viewer";
      };
      orgId?: string;
      contactSessionId?: string;
      // The raw widget session token (set by requireWidgetSession). Used to key the
      // in-memory OTP store, which stores/verifies by this exact token.
      sessionToken?: string;
      websiteId?: string;
    }
  }
}

export {};
