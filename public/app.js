const $ = (id) => document.getElementById(id);
let last;
$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = new URLSearchParams({
    title: $('title').value,
    template: $('template').value,
    theme: $('theme').value,
    accent: $('accent').value.slice(1),
  });
  if ($('subtitle').value) q.set('subtitle', $('subtitle').value);
  if ($('site').value) q.set('site', $('site').value);
  const msg = $('msg');
  msg.className = 'msg';
  msg.textContent = 'Rendering...';
  try {
    const res = await fetch('/v1/og?' + q, { headers: { 'X-API-Key': $('key').value } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      msg.className = 'msg err';
      msg.textContent = body?.error?.message ?? 'Request failed (' + res.status + ')';
      return;
    }
    if (last) URL.revokeObjectURL(last);
    last = URL.createObjectURL(await res.blob());
    $('out').src = last;
    $('out').alt = 'Rendered card: ' + $('title').value;
    $('url').textContent = location.origin + '/v1/og?' + q + '&key=YOUR_KEY';
    msg.className = 'msg ok';
    msg.textContent =
      'Rendered. ' + (res.headers.get('X-Quota-Remaining') ?? '?') + ' cards left this month.';
  } catch {
    msg.className = 'msg err';
    msg.textContent = 'Network error. Is the server running?';
  }
});
