import { useEffect, useRef, useState } from 'react';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' });
const POLL_MS = 500;

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Request failed');
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const [submitting, setSubmitting] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const pollStopsRef = useRef(new Map());

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

  function upsertTransfer(id, patch) {
    setTransfers((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index === -1) {
        return [{ id, status: 'pending', errorCode: null, ...patch }, ...current];
      }
      const next = current.slice();
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function stopPolling(id) {
    const stop = pollStopsRef.current.get(id);
    if (stop) {
      stop();
      pollStopsRef.current.delete(id);
    }
  }

  function startPolling(id) {
    if (pollStopsRef.current.has(id)) return;

    let cancelled = false;
    pollStopsRef.current.set(id, () => {
      cancelled = true;
    });

    (async () => {
      while (!cancelled) {
        try {
          const transaction = await api(`/api/transactions/${id}`);
          if (cancelled) return;
          upsertTransfer(id, {
            status: transaction.status,
            errorCode: transaction.errorCode || null,
            amount: transaction.amount,
            currency: transaction.currency,
            description: transaction.description
          });
          if (transaction.status !== 'pending') {
            stopPolling(id);
            try {
              await refresh();
            } catch (error) {
              setFeedback(error.message);
            }
            return;
          }
        } catch (error) {
          if (cancelled) return;
          upsertTransfer(id, { status: 'failed', errorCode: error.message || 'POLL_FAILED' });
          stopPolling(id);
          return;
        }
        await sleep(POLL_MS);
      }
    })();
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
      for (const stop of pollStopsRef.current.values()) stop();
      pollStopsRef.current.clear();
    };
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback('');
    try {
      const cents = Math.round(Number(amount) * 100);
      const transaction = await api('/api/transactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceAccountId,
          destinationAccountId,
          amount: cents,
          currency: 'BRL',
          description
        })
      });
      upsertTransfer(transaction.id, {
        status: transaction.status || 'pending',
        errorCode: transaction.errorCode || null,
        amount: transaction.amount ?? cents,
        currency: transaction.currency || 'BRL',
        description: transaction.description ?? description,
        sourceAccountId,
        destinationAccountId,
        submittedAt: Date.now()
      });
      if ((transaction.status || 'pending') === 'pending') {
        startPolling(transaction.id);
      } else {
        await refresh();
      }
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inFlight = transfers.filter((item) => item.status === 'pending');
  const finished = transfers.filter((item) => item.status !== 'pending');

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
          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit transfer'}
          </button>
        </form>
        {feedback ? <p className="feedback">{feedback}</p> : null}
        <p className="hint">POST returns 202 pending. Submit again while transfers process.</p>
      </section>

      <section>
        <h2>Submitted transfers</h2>
        {transfers.length === 0 ? (
          <p>No transfers submitted yet.</p>
        ) : (
          <>
            {inFlight.length > 0 ? (
              <div className="tx-group">
                <h3>In flight ({inFlight.length})</h3>
                <ul className="tx-list">
                  {inFlight.map((item) => (
                    <li key={item.id} className="tx-card status-pending">
                      <div className="tx-row">
                        <strong>{item.status}</strong>
                        <span>{money.format((item.amount || 0) / 100)}</span>
                      </div>
                      <small>{item.id}</small>
                      {item.description ? <p>{item.description}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {finished.length > 0 ? (
              <div className="tx-group">
                <h3>Finished ({finished.length})</h3>
                <ul className="tx-list">
                  {finished.map((item) => (
                    <li
                      key={item.id}
                      className={`tx-card status-${item.status === 'completed' ? 'completed' : 'failed'}`}
                    >
                      <div className="tx-row">
                        <strong>{item.status}</strong>
                        <span>{money.format((item.amount || 0) / 100)}</span>
                      </div>
                      <small>{item.id}</small>
                      {item.description ? <p>{item.description}</p> : null}
                      {item.errorCode ? <p className="error-code">errorCode: {item.errorCode}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
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
