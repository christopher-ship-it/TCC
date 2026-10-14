import { useRef, useState } from 'react';
import { Database, Download, Upload } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { STATE_DEFS } from '../../data/seed';
import { BRAND, WHITE_LABEL } from '../../brand';
import { customerCsvTemplate, parseCustomerCsv, type ImportRowError } from '../../lib/customerImport';
import type { CustomerUser } from '../../data/types';
import { downloadText } from '../../lib/metrics';
import { Badge, Button, Callout, Card, PageHead } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

/**
 * Replaces the generated sample customers (src/data/seed.ts) with a real CSV export — from
 * RealBroks/IronDrobe's admin panel today, or any future source, manual or API-fed, that can be
 * turned into the same file. Call history, tickets, follow-ups and ownership are kept for any
 * customer whose phone number reappears in a later import.
 */
export default function CustomerImport() {
  const { state, currentAgent, dispatch } = useStore();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CustomerUser[] | null>(null);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [importing, setImporting] = useState(false);

  const sampleCount = state.customerSource === 'sample' ? state.users.length : null;
  const importedCount = state.customerSource === 'imported' ? state.users.length : null;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setErrors([]);
    file.text().then((text) => {
      const { customers, errors } = parseCustomerCsv(text, STATE_DEFS);
      setPreview(customers);
      setErrors(errors);
    });
  }

  function confirmImport() {
    if (!preview || preview.length === 0 || !currentAgent) return;
    setImporting(true);
    try {
      dispatch({ type: 'IMPORT_CUSTOMERS', customers: preview, actorId: currentAgent.id });
      toast(`Imported ${preview.length} real customers`);
      setPreview(null);
      setErrors([]);
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
        desc={WHITE_LABEL ? `Replace the sample subscribers with a real export from ${BRAND.name}.` : 'Replace the generated sample customers with a real export from RealBroks or IronDrobe.'}
      />

      <Card title="Current data source">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Database size={16} />
          {sampleCount !== null ? (
            <span>
              <Badge tone="warn">Sample data</Badge> {sampleCount.toLocaleString('en-IN')} generated customers — import a real file below to replace them.
            </span>
          ) : (
            <span>
              <Badge tone="ok">Imported</Badge> {importedCount?.toLocaleString('en-IN')} real customers.
            </span>
          )}
        </div>
      </Card>

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
                <Button variant="primary" onClick={confirmImport} disabled={importing}>
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
