import { useEffect, useState } from 'react';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' });

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Request failed');
  return body;
}

export default function App() {
  const [health, setHealth] = useState({ status: 'connecting', stack: '' });
  const [accounts, setAccounts] = useState([]);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [amount, setAmount] = useState('25.00');
  const [description, setDescription] = useState('Demo transfer');
  const [historyAccountId, setHistoryAccountId] = useState('');
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadAccounts() {
    const { accounts: next } = await api('/api/accounts');
    setAccounts(next);
    setSourceAccountId((current) => current || next[0]?.id || '');
    setDestinationAccountId((current) => current || next[1]?.id || next[0]?.id || '');
    setHistoryAccountId((current) => current || next[0]?.id || '');
    return next;
  }

  async function loadHistory(accountId) {
    if (!accountId) {
      setHistory([]);
      return;
    }
    const { transactions } = await api(`/api/accounts/${accountId}/transactions`);
    setHistory(transactions);
  }

  async function refresh() {
    const next = await loadAccounts();
    const accountId = historyAccountId || next[0]?.id;
    await loadHistory(accountId);
  }

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const body = await api('/api/health');
        if (!cancelled) setHealth({ status: body.status, stack: body.stack });
      } catch {
        if (!cancelled) setHealth({ status: 'offline', stack: '' });
      }
      try {
        if (!cancelled) await refresh();
      } catch (error) {
        if (!cancelled) setFeedback(error.message);
      }
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pollTransaction(id) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const transaction = await api(`/api/transactions/${id}`);
      const suffix = transaction.errorCode ? ` · ${transaction.errorCode}` : '';
      setFeedback(`${transaction.id} · ${transaction.status}${suffix}`);
      if (transaction.status !== 'pending') {
        await refresh();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setFeedback(`${id} · still pending`);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback('submitting');
    try {
      const transaction = await api('/api/transactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceAccountId,
          destinationAccountId,
          amount: Math.round(Number(amount) * 100),
          currency: 'BRL',
          description
        })
      });
      await pollTransaction(transaction.id);
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <div>
          <h1>ledger-core tester</h1>
          <p id="health">
            health: {health.status}
            {health.stack ? ` · stack: ${health.stack}` : ''}
          </p>
        </div>
        <button type="button" onClick={() => refresh().catch((error) => setFeedback(error.message))}>
          Refresh
        </button>
      </header>

      <section>
        <h2>Accounts</h2>
        {accounts.length === 0 ? <p>No accounts.</p> : (
          <ul>
            {accounts.map((account) => (
              <li key={account.id}>
                <strong>{account.name}</strong>
                {' '}
                {money.format(account.balance / 100)}
                {' '}
                <small>{account.id}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Transfer</h2>
        <form onSubmit={onSubmit}>
          <label>
            Source
            <select value={sourceAccountId} onChange={(event) => setSourceAccountId(event.target.value)} required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label>
            Destination
            <select value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)} required>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label>
            Amount (BRL)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label>
            Description
            <input
              maxLength={120}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>Submit transfer</button>
        </form>
        {feedback ? <p>{feedback}</p> : null}
      </section>

      <section>
        <h2>Account history</h2>
        <label>
          Account
          <select
            value={historyAccountId}
            onChange={(event) => {
              const id = event.target.value;
              setHistoryAccountId(id);
              loadHistory(id).catch((error) => setFeedback(error.message));
            }}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Counterparty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr><td colSpan={4}>No ledger entries yet.</td></tr>
            ) : history.map((entry) => (
              <tr key={`${entry.transactionId}-${entry.accountId || entry.counterpartyAccountId}`}>
                <td>{entry.createdAt ? new Date(entry.createdAt).toISOString() : '—'}</td>
                <td>{entry.description || '—'}</td>
                <td>{entry.counterpartyAccountId || '—'}</td>
                <td>{money.format(entry.amount / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
