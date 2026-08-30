const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let accounts = [];

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Unexpected request failure');
  return body;
}

async function loadAccounts() {
  accounts = (await api('/api/accounts')).accounts;
  $('#accounts').innerHTML = accounts.map((account) => `
    <article class="account">
      <p>${account.name}</p>
      <strong>${money.format(account.balance / 100)}</strong>
      <small>${account.id}</small>
    </article>`).join('');

  const options = accounts.map((account) => `<option value="${account.id}">${account.name}</option>`).join('');
  const previousHistory = $('#history-account').value;
  $('#source').innerHTML = options;
  $('#destination').innerHTML = options;
  $('#destination').selectedIndex = Math.min(1, accounts.length - 1);
  $('#history-account').innerHTML = options;
  if (accounts.some((account) => account.id === previousHistory)) $('#history-account').value = previousHistory;
}

async function loadHistory() {
  const accountId = $('#history-account').value;
  if (!accountId) return;
  const { transactions } = await api(`/api/accounts/${accountId}/transactions`);
  $('#history').innerHTML = transactions.length ? transactions.map((entry) => `
    <tr>
      <td>${new Date(entry.createdAt).toLocaleString('pt-BR')}</td>
      <td>${entry.description || '—'}</td>
      <td>${entry.counterpartyAccountId}</td>
      <td class="${entry.amount > 0 ? 'positive' : 'negative'}">${money.format(entry.amount / 100)}</td>
    </tr>`).join('') : '<tr><td colspan="4">No ledger entries yet.</td></tr>';
}

async function refresh() {
  await loadAccounts();
  await loadHistory();
}

async function pollTransaction(id) {
  // Polling keeps this demo dependency-free; production could use SSE or WebSocket.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const transaction = await api(`/api/transactions/${id}`);
    $('#feedback').className = `feedback status ${transaction.status}`;
    $('#feedback').textContent = `${transaction.id} · ${transaction.status}${transaction.errorCode ? ` · ${transaction.errorCode}` : ''}`;
    if (transaction.status !== 'pending') {
      await refresh();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

$('#transfer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#flow').hidden = false;
  $('#feedback').className = 'feedback status pending';
  $('#feedback').textContent = 'Publishing transfer...';
  try {
    const transaction = await api('/api/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceAccountId: $('#source').value,
        destinationAccountId: $('#destination').value,
        amount: Math.round(Number($('#amount').value) * 100),
        currency: 'BRL',
        description: $('#description').value
      })
    });
    await pollTransaction(transaction.id);
  } catch (error) {
    $('#feedback').className = 'feedback status failed';
    $('#feedback').textContent = error.message;
  }
});

$('#refresh').addEventListener('click', refresh);
$('#history-account').addEventListener('change', loadHistory);

api('/api/health')
  .then(() => { $('#health').textContent = 'online'; $('#health').className = 'status ok'; })
  .catch(() => { $('#health').textContent = 'offline'; $('#health').className = 'status failed'; });
refresh().catch((error) => { $('#feedback').textContent = error.message; });
