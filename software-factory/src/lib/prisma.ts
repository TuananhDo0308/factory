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

const PRISMA_SCHEMA_REV = "v8-prototypes-context-lake";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaRev?: string;
  prismaDatabaseUrl?: string;
};

function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: process.env.VERCEL ? 5 : 10,
  });
  return new PrismaClient({ adapter });
}

function getOrCreatePrisma(): PrismaClient {
  const connectionString = resolveDatabaseUrl();
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaSchemaRev === PRISMA_SCHEMA_REV &&
    globalForPrisma.prismaDatabaseUrl === connectionString &&
    "projectMember" in globalForPrisma.prisma &&
    "projectContextFile" in globalForPrisma.prisma &&
    "projectPrototype" in globalForPrisma.prisma
  ) {
    return globalForPrisma.prisma;
  }
  const client = createPrismaClient(connectionString);
  globalForPrisma.prisma = client;
  globalForPrisma.prismaSchemaRev = PRISMA_SCHEMA_REV;
  globalForPrisma.prismaDatabaseUrl = connectionString;
  return client;
}

export const prisma: PrismaClient = getOrCreatePrisma();
