import { ReposList } from "@/components/repos/ReposList";

export default function ReposPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-semibold text-text">Repositories</h1>
      <ReposList />
    </div>
  );
}
