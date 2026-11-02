import { useRef, useState } from 'react';
import { Database, Download, Upload } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { STATE_DEFS } from '../../data/seed';
import { BRAND, WHITE_LABEL } from '../../brand';
import { customerCsvTemplate, parseCustomerCsv, type ImportRowError } from '../../lib/customerImport';
import { isActive } from '../../lib/access';
import { countByOrigin } from '../../lib/world';
import type { CustomerUser } from '../../data/types';
import { downloadText } from '../../lib/metrics';
import { Badge, Button, Callout, Card, PageHead } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

/**
 * Loads real customers from a CSV export — from RealBroks/IronDrobe's admin panel today, or any future
 * source, manual or API-fed, that can be turned into the same file. Every row is stamped as coming from
 * the app. The demo customers (src/data/seed.ts) are not touched. Call history, tickets, follow-ups and
 * ownership are kept for any customer whose phone number reappears in a later import.
 */
export default function CustomerImport() {
  const { state, currentAgent, dispatch } = useStore();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CustomerUser[] | null>(null);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [warnings, setWarnings] = useState<ImportRowError[]>([]);
  const [importing, setImporting] = useState(false);

  const totals = Object.values(countByOrigin(state.allUsers)).reduce((t, c) => ({ app: t.app + c.app, tcc: t.tcc + c.tcc, sample: t.sample + c.sample }), { app: 0, tcc: 0, sample: 0 });
  // Only active, real (non-demo) people may be named as an owner in the file.
  const ownerIds = new Set(state.allAgents.filter((a) => !a.demo && isActive(a)).map((a) => a.id));
  const isDemo = !!currentAgent?.demo;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setErrors([]);
    setWarnings([]);
    file.text().then((text) => {
      const { customers, errors, warnings } = parseCustomerCsv(text, STATE_DEFS, ownerIds);
      setPreview(customers);
      setErrors(errors);
      setWarnings(warnings);
    });
  }

  function confirmImport() {
    if (!preview || preview.length === 0 || !currentAgent || isDemo) return;
    setImporting(true);
    try {
      dispatch({ type: 'IMPORT_CUSTOMERS', customers: preview, actorId: currentAgent.id });
      toast(`Imported ${preview.length} real customers`);
      setPreview(null);
      setErrors([]);
      setWarnings([]);
      setFileName(null);
      if (fileInput.current) fileInput.current.value = '';
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Customers"
        desc={WHITE_LABEL ? `Load the real subscribers from ${BRAND.name}'s export.` : 'Load the real customers from a RealBroks or IronDrobe export.'}
      />

      <Card title="Where the customers come from">
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Database size={16} />
            {totals.app > 0 ? (
              <span><Badge tone="ok">From the app</Badge> {totals.app.toLocaleString('en-IN')} real customers, imported from {WHITE_LABEL ? BRAND.name : 'RealBroks / IronDrobe'}.</span>
            ) : (
              <span><Badge tone="danger">None yet</Badge> No real customers are loaded. Import a file below — agents have nobody real to call until you do.</span>
            )}
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Badge tone="accent">Created in TCC</Badge>
            <span>{totals.tcc.toLocaleString('en-IN')} numbers dialled by agents that are not customers yet.</span>
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <Badge tone="warn">Demo data</Badge>
            <span>{totals.sample.toLocaleString('en-IN')} practice customers. Only demo accounts see them; they are never dialled for real and are not touched by an import.</span>
          </div>
        </div>
      </Card>
      {isDemo && <Callout tone="warn">Demo accounts can’t import customers — sign in with a real admin account.</Callout>}

      <Card title="Import customers" sub="CSV only — in Excel, use File › Save As › CSV UTF-8 before uploading.">
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <Button icon={<Download size={15} />} onClick={() => downloadText('tcc-customer-import-template.csv', WHITE_LABEL ? customerCsvTemplate(`${BRAND.key},Murugan S,9876543210,₹1,00,000 chit · 20 months,Coimbatore,Tamil Nadu,Paid,4,20,2026-06-15,Tamil,`) : customerCsvTemplate())}>
              Download CSV template
            </Button>
            <Button icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>
              Choose CSV file
            </Button>
            <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: 'none' }} />
            {fileName && <span className="muted" style={{ fontSize: 13 }}>{fileName}</span>}
          </div>

          <p className="muted" style={{ fontSize: 13 }}>
            Required columns: <b>app</b> ({WHITE_LABEL ? BRAND.key : 'realbroks or irondrobe'}), <b>name</b>, <b>phone</b>. Optional: business, city,
            state, plan (Free/Paid), listings, buyers, registered_at, language, owner_agent_id. Each customer is
            matched by phone number — re-importing the same phone updates it in place and keeps its call history.
          </p>

          {preview !== null && (
            <>
              {preview.length > 0 && (
                <Callout tone="ok">
                  {preview.length} customer{preview.length === 1 ? '' : 's'} ready to import.
                </Callout>
              )}
              {warnings.length > 0 && (
                <Callout tone="warn">
                  {warnings.length} row{warnings.length === 1 ? '' : 's'} imported with a change:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {warnings.slice(0, 10).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                  </ul>
                  {warnings.length > 10 && <div>…and {warnings.length - 10} more.</div>}
                </Callout>
              )}
              {errors.length > 0 && (
                <Callout tone="warn">
                  {errors.length} row{errors.length === 1 ? '' : 's'} skipped — fix these in the file and re-upload if they matter:
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {errors.slice(0, 20).map((e, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                  </ul>
                  {errors.length > 20 && <div>…and {errors.length - 20} more.</div>}
                </Callout>
              )}
              {preview.length > 0 && (
                <Button variant="primary" onClick={confirmImport} disabled={importing || isDemo}>
                  {importing ? 'Importing…' : `Import ${preview.length} customer${preview.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
