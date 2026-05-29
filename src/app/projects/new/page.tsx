// /projects/new — server component shell hosting the client form.
// The client form handles useActionState; this file just supplies the
// layout chrome (header, navy-dark panel).
import { NewProjectForm } from "./_form";

export default function NewProjectPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-display text-5xl tracking-wider text-white">
        NEW PROJECT
      </h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-wider text-muted">
        Create a project — slug becomes the URL path; everything else is editable later.
      </p>

      <div className="mt-8 border border-panel-border bg-navy-dark p-6">
        <NewProjectForm />
      </div>
    </main>
  );
}
