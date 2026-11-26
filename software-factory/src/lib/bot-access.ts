import { unsealToken } from "@/lib/crypto";
import {
  acceptRepoInvitation,
  addRepoCollaborator,
  findPendingRepoInvitationId,
  getOAuthConfig,
} from "@/lib/github";
import { prisma } from "@/lib/prisma";

export type BotAccessStatus = "owner" | "active" | "invited" | "failed" | "none";

export type BotAccessResult = {
  botGithubUsername: string | null;
  botAccessStatus: BotAccessStatus;
  botAccessError: string | null;
  botInvitationId: number | null;
};

export function getFactoryBotUsername(): string | null {
  const username = (process.env.FACTORY_BOT_GITHUB_USERNAME || "").trim();
  return username || null;
}

async function resolveBotAccessToken(botUsername: string): Promise<string | null> {
  const envToken = (process.env.FACTORY_BOT_GITHUB_TOKEN || "").trim();
  if (envToken) return envToken;

  // Fallback: reuse the latest active encrypted OAuth session of the bot account in DB.
  const { clientSecret } = getOAuthConfig();
  const botUser = await prisma.user.findFirst({
    where: { githubLogin: botUsername },
    include: {
      sessions: {
        where: { expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  const latestSession = botUser?.sessions[0];
  if (!latestSession) return null;

  try {
    return unsealToken(latestSession.githubAccessToken, clientSecret);
  } catch {
    return null;
  }
}

/**
 * Ensures the configured Factory AI Server GitHub account (`FACTORY_BOT_GITHUB_USERNAME`)
 * has `push` access to `owner/repo`:
 * 1. If `owner` already is the bot account -> status "owner" (instant access).
 * 2. Otherwise invites the bot via GitHub Collaborators API (`permission: "push"`).
 * 3. If the bot's own token is available (env PAT or active DB session), auto-accepts
 *    the invitation right away -> status "active".
 */
export async function ensureFactoryBotCollaborator(input: {
  userAccessToken: string | null;
  owner: string;
  repo: string;
  existingInvitationId?: number | null;
}): Promise<BotAccessResult> {
  const botUsername = getFactoryBotUsername();
  if (!botUsername) {
    return {
      botGithubUsername: null,
      botAccessStatus: "none",
      botAccessError: null,
      botInvitationId: null,
    };
  }

  if (input.owner.toLowerCase() === botUsername.toLowerCase()) {
    return {
      botGithubUsername: botUsername,
      botAccessStatus: "owner",
      botAccessError: null,
      botInvitationId: null,
    };
  }

  const fullName = `${input.owner}/${input.repo}`;
  const botToken = await resolveBotAccessToken(botUsername);

  // If there's already an invitation ID (or pending invite), try auto-accepting first.
  if (botToken) {
    const pendingId =
      input.existingInvitationId ?? (await findPendingRepoInvitationId(botToken, fullName));
    if (pendingId !== null) {
      const accepted = await acceptRepoInvitation(botToken, pendingId).catch(() => false);
      if (accepted) {
        return {
          botGithubUsername: botUsername,
          botAccessStatus: "active",
          botAccessError: null,
          botInvitationId: null,
        };
      }
    }
  }

  if (!input.userAccessToken) {
    return {
      botGithubUsername: botUsername,
      botAccessStatus: "failed",
      botAccessError: "GitHub session token missing; sign in again to grant AI server access.",
      botInvitationId: null,
    };
  }

  try {
    const res = await addRepoCollaborator(input.userAccessToken, {
      owner: input.owner,
      repo: input.repo,
      username: botUsername,
      permission: "push",
    });

    if (res.kind === "already_collaborator") {
      return {
        botGithubUsername: botUsername,
        botAccessStatus: "active",
        botAccessError: null,
        botInvitationId: null,
      };
    }

    // Invitation created -> attempt immediate auto-accept using the bot account's token.
    let invitationId = res.invitationId;
    if (botToken) {
      if (invitationId === null) {
        invitationId = await findPendingRepoInvitationId(botToken, fullName);
      }
      if (invitationId !== null) {
        const accepted = await acceptRepoInvitation(botToken, invitationId).catch(() => false);
        if (accepted) {
          return {
            botGithubUsername: botUsername,
            botAccessStatus: "active",
            botAccessError: null,
            botInvitationId: null,
          };
        }
      }
    }

    return {
      botGithubUsername: botUsername,
      botAccessStatus: "invited",
      botAccessError: null,
      botInvitationId: invitationId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to invite AI server account";
    return {
      botGithubUsername: botUsername,
      botAccessStatus: "failed",
      botAccessError: message.slice(0, 300),
      botInvitationId: null,
    };
  }
}
