import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function resolveDatabaseUrl(): string {
  const raw = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL ||
    ""
  ).trim();
  if (!raw) {
    throw new Error(
      "DATABASE_URL is not configured. Set a PostgreSQL connection string in your environment.",
    );
  }
  return raw;
}

const PRISMA_SCHEMA_REV = "v7-postgresql";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaRev?: string;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: resolveDatabaseUrl(),
    max: process.env.VERCEL ? 5 : 10,
  });
  return new PrismaClient({ adapter });
}

function getOrCreatePrisma(): PrismaClient {
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaSchemaRev === PRISMA_SCHEMA_REV &&
    "projectMember" in globalForPrisma.prisma
  ) {
    return globalForPrisma.prisma;
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaSchemaRev = PRISMA_SCHEMA_REV;
  return client;
}

export const prisma: PrismaClient = getOrCreatePrisma();
