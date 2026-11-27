import { ProjectPage } from "../project-page";

export default async function ProjectPrototypesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectPage id={id} section="prototypes" />;
}
