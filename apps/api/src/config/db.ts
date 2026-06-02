import mongoose from "mongoose";
import { env } from "./env.js";

export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri, {
    autoIndex: env.nodeEnv !== "production",
  });
  // eslint-disable-next-line no-console
  console.log("[db] connected to MongoDB");
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
