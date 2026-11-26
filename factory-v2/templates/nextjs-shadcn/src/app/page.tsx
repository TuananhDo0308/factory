import { ExemplarCard } from "@/components/exemplar-card";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-4 py-12">
      <ExemplarCard
        title="Factory v2 Starter"
        description="Ready for /f-plan and /f-run with shadcn/ui primitives, Lucide icons, happy-dom, and Playwright."
      />
    </main>
  );
}
