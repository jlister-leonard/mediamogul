// Share-target destination (declared in app/manifest.ts). This stub echoes
// whatever the OS share sheet sends; E8.1 replaces it with the real capture
// flow that resolves shares into items.

type ShareParams = { title?: string; text?: string; url?: string };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<ShareParams>;
}) {
  const { title, text, url } = await searchParams;
  const received = (
    [
      ["Title", title],
      ["Text", text],
      ["URL", url],
    ] as const
  ).filter(([, value]) => value);

  return (
    <main className="mx-auto min-h-dvh max-w-xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      {received.length > 0 ? (
        <dl className="mt-6 space-y-4">
          {received.map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm font-medium opacity-60">{label}</dt>
              <dd className="mt-1 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-6 opacity-60">
          Nothing here yet. Share a link to Nightstand and it will land on this
          page.
        </p>
      )}
    </main>
  );
}
