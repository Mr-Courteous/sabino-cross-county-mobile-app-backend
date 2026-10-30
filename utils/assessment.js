/**
 * Flexible assessment engine
 * ---------------------------------------------------------------------
 * One place that knows how a school's result template works:
 *   - the built-in DEFAULT template (CA1-CA4 /10, Exam /60, A-F bands)
 *   - validation of a school's custom template + grading scale
 *   - saving a score record (validated against the school's template,
 *     and stamped with a frozen copy of that template)
 *   - turning stored rows into a report layout (columns + cells)
 *
 * Key rule: a school with no saved configuration, and every score row
 * created before this feature, behave EXACTLY as before. Custom behaviour
 * only applies to rows saved while the school has a custom template, and
 * those rows keep their own frozen template until they are edited or the
 * school explicitly applies the new template.
 */

// ── Built-in default (mirrors the previously hard-coded behaviour) ──────
const LEGACY_COLUMNS = {
  ca1: 'ca1_score',
  ca2: 'ca2_score',
  ca3: 'ca3_score',
  ca4: 'ca4_score',
  exam: 'exam_score',
};

const COMPUTED_SOURCES = ['total', 'grade', 'remark', 'class_average', 'class_min', 'class_max'];
const COMPUTED_LABELS = {
  total: 'Total',
  grade: 'Grade',
  remark: 'Remark',
  class_average: 'Class Avg',
  class_min: 'Min',
  class_max: 'Max',
};

const DEFAULT_COMPONENTS = [
  { key: 'ca1', label: 'CA1', type: 'number', max: 10, counts_toward_total: true, visible: true },
  { key: 'ca2', label: 'CA2', type: 'number', max: 10, counts_toward_total: true, visible: true },
  { key: 'ca3', label: 'CA3', type: 'number', max: 10, counts_toward_total: true, visible: true },
  { key: 'ca4', label: 'CA4', type: 'number', max: 10, counts_toward_total: true, visible: true },
  { key: 'exam', label: 'Exam', type: 'number', max: 60, counts_toward_total: true, visible: true },
  { key: 'total', label: 'Total', type: 'computed', source: 'total', visible: true },
];

// Same boundaries the existing SQL CASE blocks in scores.js use.
const DEFAULT_GRADING_BANDS = [
  { min: 70, grade: 'A', remark: 'Excellent' },
  { min: 60, grade: 'B', remark: 'Very Good' },
  { min: 50, grade: 'C', remark: 'Good' },
  { min: 40, grade: 'D', remark: 'Fair' },
  { min: 30, grade: 'E', remark: 'Poor' },
  { min: 0, grade: 'F', remark: 'Very Poor' },
];

const MAX_COMPONENTS = 20;
const MAX_TEXT_LENGTH = 500;
const KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;
const RESERVED_KEYS = new Set(['total', 'grade', 'remark', 'subject', 'subject_name', 'id']);

const clone = (v) => JSON.parse(JSON.stringify(v));

// ── Helpers ─────────────────────────────────────────────────────────────
function totalMaxOf(components) {
  return components
    .filter((c) => c.type === 'number' && c.counts_toward_total !== false)
    .reduce((sum, c) => sum + Number(c.max || 0), 0);
}

function sortBands(bands) {
  return [...bands].sort((a, b) => b.min - a.min);
}

/** Letter grade + remark for a total, given a band list (any order). */
function gradeFor(total, bands) {
  const list = sortBands(Array.isArray(bands) && bands.length ? bands : DEFAULT_GRADING_BANDS);
  const t = Number(total) || 0;
  for (const band of list) {
    if (t >= Number(band.min)) return { grade: band.grade, remark: band.remark || '' };
  }
  const last = list[list.length - 1];
  return { grade: last.grade, remark: last.remark || '' };
}

// ── Validation of a school's configuration ──────────────────────────────
/**
 * @returns {{ok:boolean, errors:string[], config?:{components:[], grading_bands:[], total_max:number}}}
 */
function validateConfig(input) {
  const errors = [];
  const rawComponents = input?.components;
  const rawBands = input?.grading_bands;

  if (!Array.isArray(rawComponents) || rawComponents.length === 0) {
    return { ok: false, errors: ['components must be a non-empty array'] };
  }
  if (rawComponents.length > MAX_COMPONENTS) {
    errors.push(`A template can have at most ${MAX_COMPONENTS} columns`);
  }

  const seen = new Set();
  const components = [];
  rawComponents.forEach((c, i) => {
    const where = `Column ${i + 1}`;
    const key = String(c?.key ?? '').trim();
    const label = String(c?.label ?? '').trim();
    const type = c?.type;

    if (!KEY_RE.test(key)) {
      errors.push(`${where}: key must be lowercase letters/numbers/underscore, start with a letter (max 30)`);
      return;
    }
    if (RESERVED_KEYS.has(key) && type !== 'computed') {
      errors.push(`${where}: "${key}" is reserved`);
      return;
    }
    if (seen.has(key)) {
      errors.push(`${where}: duplicate key "${key}"`);
      return;
    }
    seen.add(key);
    if (!label || label.length > 30) {
      errors.push(`${where}: label is required (max 30 characters)`);
      return;
    }

    const visible = c?.visible !== false;
    if (type === 'number') {
      const max = Number(c.max);
      if (!Number.isFinite(max) || max <= 0 || max > 999) {
        errors.push(`${where} (${label}): max must be a number between 1 and 999`);
        return;
      }
      components.push({
        key, label, type, max,
        counts_toward_total: c.counts_toward_total !== false,
        visible,
      });
    } else if (type === 'text') {
      components.push({ key, label, type, visible });
    } else if (type === 'computed') {
      if (!COMPUTED_SOURCES.includes(c.source)) {
        errors.push(`${where} (${label}): source must be one of ${COMPUTED_SOURCES.join(', ')}`);
        return;
      }
      components.push({ key, label, type, source: c.source, visible });
    } else {
      errors.push(`${where} (${label}): type must be number, text or computed`);
    }
  });

  const totalMax = totalMaxOf(components);
  if (!errors.length && totalMax <= 0) {
    errors.push('At least one numeric column must count toward the total');
  }

  // Grading scale
  let bands = rawBands === undefined ? clone(DEFAULT_GRADING_BANDS) : rawBands;
  if (!Array.isArray(bands) || bands.length === 0) {
    errors.push('grading_bands must be a non-empty array');
    bands = [];
  }
  const cleanBands = [];
  bands.forEach((b, i) => {
    const min = Number(b?.min);
    const grade = String(b?.grade ?? '').trim();
    const remark = String(b?.remark ?? '').trim();
    if (!Number.isFinite(min) || min < 0) {
      errors.push(`Grade ${i + 1}: min must be a number >= 0`);
      return;
    }
    if (!grade || grade.length > 5) {
      errors.push(`Grade ${i + 1}: grade is required (max 5 characters)`);
      return;
    }
    if (remark.length > 30) {
      errors.push(`Grade ${i + 1}: remark is too long (max 30 characters)`);
      return;
    }
    cleanBands.push({ min, grade, remark });
  });
  if (cleanBands.length && !cleanBands.some((b) => b.min === 0)) {
    errors.push('The lowest grade must start at 0 so every score gets a grade');
  }
  const mins = cleanBands.map((b) => b.min);
  if (new Set(mins).size !== mins.length) {
    errors.push('Two grades cannot start at the same mark');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    config: { components, grading_bands: sortBands(cleanBands), total_max: totalMax },
  };
}

// ── Loading a school's configuration ────────────────────────────────────
function defaultConfig() {
  return {
    isCustom: false,
    version: 0,
    components: clone(DEFAULT_COMPONENTS),
    grading_bands: clone(DEFAULT_GRADING_BANDS),
    total_max: totalMaxOf(DEFAULT_COMPONENTS),
  };
}

/** `db` is a pg Pool or Client. Never throws if the table is missing. */
async function getSchoolConfig(db, schoolId) {
  try {
    const r = await db.query(
      `SELECT components, grading_bands, version FROM assessment_configs WHERE school_id = $1`,
      [schoolId]
    );
    if (r.rows.length === 0) return defaultConfig();
    const row = r.rows[0];
    return {
      isCustom: true,
      version: row.version,
      components: row.components,
      grading_bands: sortBands(row.grading_bands),
      total_max: totalMaxOf(row.components),
    };
  } catch (err) {
    if (err.code === '42P01') return defaultConfig(); // migration not run yet
    throw err;
  }
}

function buildSnapshots(config) {
  return {
    template: { version: config.version, components: clone(config.components) },
    grading: clone(config.grading_bands),
  };
}

// ── Reading incoming score payloads ─────────────────────────────────────
/**
 * Accepts any of the shapes the app already sends plus the new one:
 *   { components: { ca1: 8, comment: "Good" } }
 *   { ca1_score, ca2_score, ca3_score, ca4_score, exam_score }   (snake)
 *   { ca1Score, ..., examScore }                                  (camel)
 *   { ca1, ca2, ca3, ca4, exam }                                  (bulk-upsert)
 * null / undefined / '' for a number = "no change" (same as the old
 * COALESCE behaviour). '' for a text column clears it.
 *
 * @returns {{values: Object, errors: string[]}}
 */
function readIncomingValues(payload, config) {
  const raw = {};
  const src = payload || {};

  if (src.components && typeof src.components === 'object') {
    Object.assign(raw, src.components);
  }
  for (const [key, col] of Object.entries(LEGACY_COLUMNS)) {
    const camel = `${key}Score`;
    for (const name of [col, camel, key]) {
      if (src[name] !== undefined && raw[key] === undefined) raw[key] = src[name];
    }
  }

  const byKey = new Map(config.components.map((c) => [c.key, c]));
  const values = {};
  const errors = [];

  for (const [key, v] of Object.entries(raw)) {
    const comp = byKey.get(key);
    if (!comp || comp.type === 'computed') {
      if (v !== null && v !== undefined && v !== '') {
        errors.push(`"${key}" is not an input column in this school's template`);
      }
      continue;
    }
    if (comp.type === 'number') {
      if (v === null || v === undefined || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors.push(`${comp.label} must be a number`);
      } else if (n < 0 || n > comp.max) {
        errors.push(`${comp.label} must be between 0 and ${comp.max}`);
      } else {
        values[key] = n;
      }
    } else if (comp.type === 'text') {
      if (v === null || v === undefined) continue;
      const s = String(v).trim();
      if (s.length > MAX_TEXT_LENGTH) {
        errors.push(`${comp.label} must be at most ${MAX_TEXT_LENGTH} characters`);
      } else {
        values[key] = s;
      }
    }
  }
  return { values, errors };
}

/** Values already stored on a row, as a {key: value} map. */
function storedValues(row) {
  if (!row) return {};
  if (row.components && typeof row.components === 'object') return { ...row.components };
  const out = {};
  for (const [key, col] of Object.entries(LEGACY_COLUMNS)) {
    if (row[col] !== null && row[col] !== undefined) out[key] = Number(row[col]);
  }
  return out;
}

const sameValue = (a, b) =>
  (a === undefined || a === null ? null : a) === (b === undefined || b === null ? null : b) ||
  (typeof a === 'number' && typeof b === 'number' && a === b);

// ── Saving ──────────────────────────────────────────────────────────────
/**
 * Create/update one score record.
 *  - School on the built-in layout and row not yet customised -> the
 *    original UPSERT, untouched (zero behaviour change).
 *  - Otherwise: validate against the school's template, merge with what
 *    is stored, and (only if something actually changed) stamp the row
 *    with the current template + grading scale.
 *
 * `db` must be a pg Client inside the caller's transaction.
 * @returns {{row:Object, changed:boolean}}
 */
async function saveScoreRecord(db, { schoolId, userId, enrollmentId, subjectId, sessionId, term, incoming, config }) {
  const parsed = readIncomingValues(incoming, config);
  if (parsed.errors.length) {
    const err = new Error(parsed.errors.join('; '));
    err.status = 400;
    throw err;
  }
  const values = parsed.values;

  const existingRes = await db.query(
    `SELECT * FROM scores
      WHERE school_id = $1 AND enrollment_id = $2 AND subject_id = $3 AND session_id = $4 AND term = $5
      FOR UPDATE`,
    [schoolId, enrollmentId, subjectId, sessionId, term]
  );
  const existing = existingRes.rows[0] || null;

  // ---- Legacy path: identical to the original implementation ----------
  if (!config.isCustom && (!existing || !existing.template_snapshot)) {
    const r = await db.query(
      `INSERT INTO scores (
         school_id, enrollment_id, subject_id, session_id, term,
         ca1_score, ca2_score, ca3_score, ca4_score, exam_score, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (school_id, enrollment_id, subject_id, session_id, term)
       DO UPDATE SET
         ca1_score = COALESCE(EXCLUDED.ca1_score, scores.ca1_score),
         ca2_score = COALESCE(EXCLUDED.ca2_score, scores.ca2_score),
         ca3_score = COALESCE(EXCLUDED.ca3_score, scores.ca3_score),
         ca4_score = COALESCE(EXCLUDED.ca4_score, scores.ca4_score),
         exam_score = COALESCE(EXCLUDED.exam_score, scores.exam_score),
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        schoolId, enrollmentId, subjectId, sessionId, term,
        values.ca1 ?? null, values.ca2 ?? null, values.ca3 ?? null, values.ca4 ?? null, values.exam ?? null,
        userId,
      ]
    );
    return { row: r.rows[0], changed: true };
  }

  // ---- Snapshot path ---------------------------------------------------
  const before = storedValues(existing);
  const merged = { ...before, ...values };
  const changed =
    !existing || Object.keys(values).some((k) => !sameValue(values[k], before[k]));

  if (existing && !changed) {
    // Nothing edited: leave the record (and its frozen template) alone.
    return { row: existing, changed: false };
  }

  const snaps = buildSnapshots(config);
  const legacy = {};
  for (const [key, col] of Object.entries(LEGACY_COLUMNS)) {
    const inTemplate = config.components.some((c) => c.key === key && c.type === 'number');
    legacy[col] = inTemplate && typeof merged[key] === 'number' ? merged[key] : null;
  }

  const r = await db.query(
    `INSERT INTO scores (
       school_id, enrollment_id, subject_id, session_id, term,
       ca1_score, ca2_score, ca3_score, ca4_score, exam_score,
       components, template_snapshot, grading_snapshot, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (school_id, enrollment_id, subject_id, session_id, term)
     DO UPDATE SET
       ca1_score = EXCLUDED.ca1_score, ca2_score = EXCLUDED.ca2_score,
       ca3_score = EXCLUDED.ca3_score, ca4_score = EXCLUDED.ca4_score,
       exam_score = EXCLUDED.exam_score,
       components = EXCLUDED.components,
       template_snapshot = EXCLUDED.template_snapshot,
       grading_snapshot = EXCLUDED.grading_snapshot,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      schoolId, enrollmentId, subjectId, sessionId, term,
      legacy.ca1_score, legacy.ca2_score, legacy.ca3_score, legacy.ca4_score, legacy.exam_score,
      JSON.stringify(merged), JSON.stringify(snaps.template), JSON.stringify(snaps.grading),
      userId,
    ]
  );
  return { row: r.rows[0], changed: true };
}

/**
 * Re-stamp existing records with the school's CURRENT template (the
 * explicit "apply to existing report cards" action). Rows saved before
 * this feature are converted from their legacy columns first.
 * Optional filters: classId, sessionId, term.
 */
async function applyConfigToExisting(db, schoolId, config, { classId, sessionId, term } = {}) {
  const snaps = buildSnapshots(config);
  const params = [schoolId, JSON.stringify(snaps.template), JSON.stringify(snaps.grading)];
  const where = ['s.school_id = $1'];
  if (sessionId) { params.push(sessionId); where.push(`s.session_id = $${params.length}`); }
  if (term) { params.push(term); where.push(`s.term = $${params.length}`); }
  if (classId) {
    params.push(classId);
    where.push(`s.enrollment_id IN (SELECT id FROM enrollments WHERE class_id = $${params.length} AND school_id = $1)`);
  }

  const r = await db.query(
    `UPDATE scores s SET
       components = COALESCE(s.components, jsonb_strip_nulls(jsonb_build_object(
         'ca1', s.ca1_score, 'ca2', s.ca2_score, 'ca3', s.ca3_score, 'ca4', s.ca4_score, 'exam', s.exam_score))),
       template_snapshot = $2::jsonb,
       grading_snapshot = $3::jsonb,
       updated_at = CURRENT_TIMESTAMP
     WHERE ${where.join(' AND ')}`,
    params
  );
  return r.rowCount;
}

// ── Reading: turning rows into a report layout ──────────────────────────
function rowSnapshotComponents(row) {
  return row.template_snapshot?.components || DEFAULT_COMPONENTS;
}

function rowVersion(row) {
  return row.template_snapshot ? Number(row.template_snapshot.version || 0) : -1;
}

/**
 * Build one table (columns + cells) for a student's score rows.
 *
 * @param rows   score rows; need subject_name, subject_id, total_score,
 *               components, template_snapshot, grading_snapshot, legacy ca/exam columns
 * @param stats  Map subject_id -> {average, min, max} (class statistics)
 * @returns {{custom:boolean, columns:Array, rows:Array}}
 *   custom=false when every row is on the built-in layout, in which case
 *   callers keep using their existing (legacy) rendering untouched.
 */
function buildReportLayout(rows, stats) {
  const list = Array.isArray(rows) ? rows : [];
  const custom = list.some((r) => r.template_snapshot);
  if (!custom) return { custom: false, columns: [], rows: [] };

  // Reference template = the newest one used by any of the rows.
  const ref = [...list].sort((a, b) => rowVersion(b) - rowVersion(a))[0];
  const columns = clone(rowSnapshotComponents(ref)).filter((c) => c.visible !== false);
  const have = new Set(columns.map((c) => c.key));

  // Data recorded under an older template that the newest one dropped is
  // still shown (so a half-updated class never silently loses marks).
  for (const r of list) {
    for (const c of rowSnapshotComponents(r)) {
      if (c.visible === false || c.type === 'computed' || have.has(c.key)) continue;
      have.add(c.key);
      // Insert before the first computed column to keep totals at the end.
      const at = columns.findIndex((x) => x.type === 'computed');
      columns.splice(at === -1 ? columns.length : at, 0, c);
    }
  }
  // A template with inputs but no computed Total still shows one, so the
  // report always has the figure parents look for.
  if (!columns.some((c) => c.type === 'computed' && c.source === 'total')) {
    columns.push({ key: 'total', label: COMPUTED_LABELS.total, type: 'computed', source: 'total', visible: true });
  }

  const outRows = list.map((r) => {
    const vals = storedValues(r);
    const total = Number(r.total_score) || 0;
    const g = gradeFor(total, r.grading_snapshot || DEFAULT_GRADING_BANDS);
    const st = stats && stats.get ? stats.get(Number(r.subject_id)) : null;
    const cells = {};
    for (const c of columns) {
      if (c.type === 'computed') {
        switch (c.source) {
          case 'total': cells[c.key] = total; break;
          case 'grade': cells[c.key] = g.grade; break;
          case 'remark': cells[c.key] = g.remark; break;
          case 'class_average': cells[c.key] = st ? Number(st.average) : null; break;
          case 'class_min': cells[c.key] = st ? Number(st.min) : null; break;
          case 'class_max': cells[c.key] = st ? Number(st.max) : null; break;
          default: cells[c.key] = null;
        }
      } else {
        cells[c.key] = vals[c.key] === undefined ? null : vals[c.key];
      }
    }
    return {
      subject_id: r.subject_id,
      subject_name: r.subject_name,
      total_score: total,
      grade: g.grade,
      remark: g.remark,
      cells,
    };
  });

  return {
    custom: true,
    columns: columns.map((c) => ({
      key: c.key, label: c.label, type: c.type, max: c.max, source: c.source,
      counts_toward_total: c.counts_toward_total,
    })),
    total_max: totalMaxOf(rowSnapshotComponents(ref)),
    rows: outRows,
  };
}

/** Class-wide subject statistics used by the Avg/Min/Max columns. */
async function getClassSubjectStats(db, schoolId, classId, sessionId, term) {
  const map = new Map();
  if (!classId) return map;
  const r = await db.query(
    `SELECT s.subject_id,
            ROUND(AVG(s.total_score)::numeric, 1) AS average,
            MIN(s.total_score) AS min,
            MAX(s.total_score) AS max
       FROM scores s
       JOIN enrollments e ON e.id = s.enrollment_id
      WHERE s.school_id = $1 AND e.class_id = $2 AND s.session_id = $3 AND s.term = $4
      GROUP BY s.subject_id`,
    [schoolId, classId, sessionId, term]
  );
  r.rows.forEach((x) => map.set(Number(x.subject_id), x));
  return map;
}

/** Attach grade/remark computed from the row's own frozen scale. */
function applyRowGrade(row) {
  const g = gradeFor(row.total_score, row.grading_snapshot || DEFAULT_GRADING_BANDS);
  return { ...row, grade: g.grade, performance: g.remark };
}

module.exports = {
  LEGACY_COLUMNS,
  COMPUTED_SOURCES,
  COMPUTED_LABELS,
  DEFAULT_COMPONENTS,
  DEFAULT_GRADING_BANDS,
  validateConfig,
  defaultConfig,
  getSchoolConfig,
  buildSnapshots,
  readIncomingValues,
  storedValues,
  saveScoreRecord,
  applyConfigToExisting,
  buildReportLayout,
  getClassSubjectStats,
  gradeFor,
  applyRowGrade,
  totalMaxOf,
};
