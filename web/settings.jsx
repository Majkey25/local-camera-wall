import { useEffect, useRef, useState } from 'react';
import { backupFileLimit, backupPasswordMin, backupPasswordMax } from '../settings-format.mjs';
import { Icon } from './icon.jsx';

const appearanceOptions = [
  { value: 'system', label: 'Podle systému', icon: 'monitor' },
  { value: 'light', label: 'Světlý', icon: 'sun' },
  { value: 'dark', label: 'Tmavý', icon: 'moon' },
];

function downloadBackup(backup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'kamery.kamery';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings({ theme, onTheme, language, onLanguage, onExport, onImport, onClose, t }) {
  const dialog = useRef(null);
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const importing = mode === 'import';

  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => { dialog.current.querySelector(mode ? 'input' : 'input[name="theme"]:checked')?.focus(); }, [mode]);

  function show(next) {
    setMode(next);
    setError('');
    setMessage('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = fields.get('password');
    setError('');
    setBusy(true);
    try {
      if (importing) {
        const file = fields.get('backup');
        if (file.size > backupFileLimit) throw new Error('Soubor se zálohou je příliš velký.');
        let backup;
        try { backup = JSON.parse(await file.text()); }
        catch { throw new Error('Soubor není platná záloha aplikace Kamery.'); }
        await onImport({ backup, password, replace: true });
        show(null);
        setMessage('Nastavení bylo obnoveno.');
      } else {
        if (password !== fields.get('confirm')) throw new Error('Hesla k záloze se neshodují.');
        downloadBackup(await onExport(password));
        show(null);
        setMessage('Stažení zálohy bylo spuštěno.');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      form.elements.password.value = '';
      if (form.elements.confirm) form.elements.confirm.value = '';
      setBusy(false);
    }
  }

  return (
    <dialog className="settings-dialog" ref={dialog} aria-labelledby="settings-title" onClose={onClose}
      onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className="dialog-heading">
        <span className="dialog-mark"><Icon name={mode ? importing ? 'upload' : 'download' : 'settings'} /></span>
        <h2 id="settings-title">{t(mode ? importing ? 'Import nastavení' : 'Export nastavení' : 'Nastavení')}</h2>
      </div>
      {mode ? (
        <form onSubmit={submit}>
          {importing
            ? <label>{t('Soubor se zálohou')}<input type="file" name="backup" accept=".kamery" required /></label>
            : <p className="hint">{t('Záloha obsahuje kamery, jejich hesla, rozložení, vzhled a jazyk. Zvolte pro ni samostatné heslo o délce alespoň {min} znaků.', { min: backupPasswordMin })}</p>}
          <label>{t('Heslo k záloze')}
            <input type="password" name="password" required minLength={backupPasswordMin} maxLength={backupPasswordMax}
              autoComplete={importing ? 'off' : 'new-password'} />
          </label>
          {importing
            ? <p className="hint">{t('Import nahradí aktuální kamery, rozložení, vzhled a jazyk.')}</p>
            : <label>{t('Zopakujte heslo')}
              <input type="password" name="confirm" required maxLength={backupPasswordMax} autoComplete="new-password" />
            </label>}
          {error && <p className="alert" role="alert">{t(error)}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => show(null)}>{t('Zpět')}</button>
            <button className="primary" type="submit" disabled={busy}>
              {t(busy ? 'Zpracovávám…' : importing ? 'Nahradit nastavení' : 'Stáhnout zálohu')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <fieldset className="appearance">
            <legend>{t('Vzhled')}</legend>
            <div className="theme-options">
              {appearanceOptions.map(option => (
                <label className="theme-option" key={option.value}>
                  <input className="visually-hidden" type="radio" name="theme" value={option.value}
                    checked={theme === option.value} onChange={event => onTheme(event.currentTarget.value)} />
                  <Icon name={option.icon} />
                  <span>{t(option.label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>{t('Jazyk aplikace')}
            <select value={language} onChange={event => onLanguage(event.currentTarget.value)}>
              <option value="system">{t('Podle systému')}</option>
              <option value="cs" lang="cs">Čeština</option>
              <option value="en" lang="en">English</option>
            </select>
          </label>
          <div className="settings-actions">
            <button type="button" onClick={() => show('import')}><Icon name="upload" />{t('Importovat nastavení')}</button>
            <button type="button" onClick={() => show('export')}><Icon name="download" />{t('Exportovat nastavení')}</button>
          </div>
          {message && <p className="hint" role="status">{t(message)}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={() => dialog.current.close()}><Icon name="check" />{t('Hotovo')}</button>
          </div>
        </>
      )}
    </dialog>
  );
}
