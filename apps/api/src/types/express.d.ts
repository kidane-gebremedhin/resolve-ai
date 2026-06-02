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
      websiteId?: string;
    }
  }
}

export {};
