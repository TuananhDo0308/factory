export const FACTORY_INIT_ISSUE_KEY = "I0";

/**
 * Returns true if the ticket represents the human-assigned interactive `/factory init`
 * setup & architecture discussion issue created after BA/PM finalization.
 */
export function isFactoryInitIssue(issue: {
  issueKey?: string | null;
  currentPhase?: string | null;
}): boolean {
  const key = (issue.issueKey || "").trim().toUpperCase();
  if (key === FACTORY_INIT_ISSUE_KEY || key === "INIT" || key === "FACTORY-INIT") {
    return true;
  }
  return (issue.currentPhase || "").trim().toLowerCase() === "factory init";
}
