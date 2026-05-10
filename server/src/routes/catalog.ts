import { Router } from 'express';
import { z } from 'zod';
import { logAuditEvent } from '../lib/audit.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { requireAnyPermission } from '../lib/rbac.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const catalogRouter = Router();

const baseMaterialColumns = [
  'id',
  'kind',
  'title',
  'subtitle',
  'summary',
  'publisher',
  'publication_year',
  'language',
  'isbn',
  'doi',
  'call_number',
  'cover_url',
  'digital_url',
  'keywords',
  'status',
  'created_at'
];

const optionalMaterialColumns = ['issn', 'dewey_classification', 'marc_record'] as const;
let availableMaterialColumns: Set<string> | null = null;

async function getAvailableMaterialColumns() {
  if (availableMaterialColumns) return availableMaterialColumns;

  const available = new Set([...baseMaterialColumns, 'topics', 'format_notes', 'pages', 'edition', 'volume']);
  for (const column of optionalMaterialColumns) {
    const { error } = await supabaseAdmin.from('materials').select(column).limit(1);
    if (!error) {
      available.add(column);
    }
  }

  if (optionalMaterialColumns.every((column) => available.has(column))) {
    for (const column of optionalMaterialColumns) {
      available.add(column);
    }
  }

  availableMaterialColumns = available;
  return availableMaterialColumns;
}

function filterMaterialColumns<T extends Record<string, unknown>>(material: T, columns: Set<string>) {
  return Object.fromEntries(Object.entries(material).filter(([key]) => columns.has(key)));
}

function optionalText(max: number) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }, z.string().max(max).nullable().optional());
}

const optionalSummary = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length < 10 ? null : trimmed;
}, z.string().max(4000).nullable().optional());

const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  status: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12)
});

catalogRouter.get('/overview', requireAuth, requireAnyPermission('catalog:read'), async (_req, res) => {
  const [materials, copies, loans, reservations] = await Promise.all([
    supabaseAdmin.from('materials').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('material_copies').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('loans').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('reservations').select('id', { count: 'exact', head: true })
  ]);

  return res.json({
    materials: materials.count ?? 0,
    copies: copies.count ?? 0,
    loans: loans.count ?? 0,
    reservations: reservations.count ?? 0
  });
});

catalogRouter.get('/materials', requireAuth, requireAnyPermission('catalog:read'), async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid catalog filters', parsed.error.flatten());
  }

  const { q, type, tag, status, page, limit } = parsed.data;
  const materialColumns = await getAvailableMaterialColumns();
  const selectColumns = baseMaterialColumns
    .concat(optionalMaterialColumns.filter((column) => materialColumns.has(column)))
    .join(',');

  let query = supabaseAdmin
    .from('materials')
    .select(selectColumns, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (q) {
    const searchColumns = ['title', 'summary', 'publisher', 'isbn', 'doi', 'call_number'];
    if (materialColumns.has('issn')) searchColumns.push('issn');
    if (materialColumns.has('dewey_classification')) searchColumns.push('dewey_classification');
    query = query.or(searchColumns.map((column) => `${column}.ilike.%${q}%`).join(','));
  }

  if (type) {
    query = query.eq('kind', type);
  }

  query = query.eq('status', status ?? 'published');

  const { data, error, count } = await query;
  if (error) {
    return sendError(res, 500, 'Unable to load materials', error.message);
  }

  let materials = (data ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>;
  if (tag) {
    const { data: tagRows, error: tagLookupError } = await supabaseAdmin
      .from('tags')
      .select('id')
      .eq('name', tag);

    if (tagLookupError) {
      return sendError(res, 500, 'Unable to filter by tag', tagLookupError.message);
    }

    const tagIds = (tagRows ?? []).map((row) => row.id);
    if (tagIds.length > 0) {
      const { data: materialTags, error: materialTagsError } = await supabaseAdmin
        .from('material_tags')
        .select('material_id')
        .in('tag_id', tagIds);

      if (materialTagsError) {
        return sendError(res, 500, 'Unable to filter by tag', materialTagsError.message);
      }

      const materialIds = new Set((materialTags ?? []).map((row) => row.material_id));
      materials = materials.filter((item) => materialIds.has(item.id));
    } else {
      materials = [];
    }
  }

  return res.json({
    items: materials,
    page,
    limit,
    total: count ?? materials.length
  });
});

catalogRouter.get('/materials/:id', requireAuth, requireAnyPermission('catalog:read'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .select(
      `
      *,
      material_contributors(name, role, sort_order),
      material_tags(tags(name)),
      material_relations!material_relations_source_material_id_fkey(relation_type, target_material_id, note),
      material_copies(*),
      digital_assets(*)
    `
    )
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load material', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Material not found');
  }

  return res.json({ material: data });
});

export const materialSchema = z.object({
  kind: z.enum([
    'physical_book',
    'ebook',
    'magazine',
    'journal_article',
    'thesis',
    'audiobook',
    'multimedia',
    'institutional_document'
  ]),
  title: z.string().min(2).max(200),
  subtitle: optionalText(200),
  summary: optionalSummary,
  publisher: optionalText(180),
  publication_year: z.coerce.number().int().min(0).max(2100).optional().nullable(),
  language: optionalText(40),
  isbn: optionalText(32),
  issn: optionalText(32),
  doi: optionalText(120),
  call_number: optionalText(80),
  dewey_classification: optionalText(80),
  marc_record: z.record(z.unknown()).optional().nullable(),
  cover_url: z.preprocess((value) => (value === '' ? null : value), z.string().url().optional().nullable()),
  digital_url: z.preprocess((value) => (value === '' ? null : value), z.string().url().optional().nullable()),
  format_notes: optionalText(1000),
  pages: z.coerce.number().int().positive().optional().nullable(),
  edition: optionalText(80),
  volume: optionalText(80),
  topics: z.array(z.string().min(1).max(80)).max(20).default([]),
  keywords: z.array(z.string().min(1).max(40)).max(15).default([]),
  contributors: z
    .array(
      z.object({
        name: z.string().min(2).max(120),
        role: z.string().min(2).max(50).default('author'),
        sort_order: z.coerce.number().int().min(0).default(0)
      })
    )
    .default([]),
  tags: z.array(z.string().min(1).max(40)).max(15).default([])
});

const copySchema = z.object({
  material_id: z.string().uuid(),
  barcode: z.string().trim().max(80).optional().nullable(),
  copy_code: z.string().trim().max(80).optional().nullable(),
  copy_type: z.string().trim().max(40).default('physical'),
  status: z.enum(['available', 'borrowed', 'reserved', 'lost', 'maintenance', 'archived']).default('available'),
  location: z.string().trim().max(160).optional().nullable(),
  shelf_code: z.string().trim().max(80).optional().nullable(),
  acquired_at: z.string().trim().optional().nullable(),
  condition_note: z.string().trim().max(1000).optional().nullable(),
  access_expires_at: z.string().trim().optional().nullable(),
  last_audited_at: z.string().trim().optional().nullable(),
  metadata: z.record(z.unknown()).default({})
});

async function replaceContributors(materialId: string, contributors: z.infer<typeof materialSchema>['contributors']) {
  await supabaseAdmin.from('material_contributors').delete().eq('material_id', materialId);
  if (contributors.length === 0) return;

  const { error } = await supabaseAdmin.from('material_contributors').insert(
    contributors.map((contributor) => ({
      material_id: materialId,
      ...contributor
    }))
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function replaceTags(materialId: string, tags: string[]) {
  await supabaseAdmin.from('material_tags').delete().eq('material_id', materialId);
  if (tags.length === 0) return;

  await supabaseAdmin.from('tags').upsert(tags.map((name) => ({ name })), { onConflict: 'name' });
  const { data: tagData, error: tagError } = await supabaseAdmin.from('tags').select('id,name').in('name', tags);
  if (tagError) {
    throw new Error(tagError.message);
  }

  const { error } = await supabaseAdmin.from('material_tags').insert(
    (tagData ?? []).map((tagRow) => ({
      material_id: materialId,
      tag_id: tagRow.id
    }))
  );

  if (error) {
    throw new Error(error.message);
  }
}

catalogRouter.post(['/', '/materials'], requireAuth, requireAnyPermission('catalog:create'), async (req: AuthedRequest, res) => {
  const parsed = materialSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid material payload', parsed.error.flatten());
  }

  const materialColumns = await getAvailableMaterialColumns();
  const { contributors, tags, ...material } = parsed.data;
  const { data: inserted, error } = await supabaseAdmin
    .from('materials')
    .insert({
      ...filterMaterialColumns(material, materialColumns),
      created_by: req.auth!.userId,
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create material', error.message);
  }

  try {
    await replaceContributors(inserted.id, contributors);
    await replaceTags(inserted.id, tags);
  } catch (syncError) {
    return sendError(res, 500, 'Material created but related data could not be saved', syncError instanceof Error ? syncError.message : 'Unknown error');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'catalog.create',
    entityType: 'material',
    entityId: inserted.id,
    metadata: {
      kind: inserted.kind,
      title: inserted.title
    }
  });

  return res.status(201).json({ material: inserted });
});

catalogRouter.patch('/materials/:id', requireAuth, requireAnyPermission('catalog:update'), async (req: AuthedRequest, res) => {
  const parsed = materialSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid material payload', parsed.error.flatten());
  }

  const materialColumns = await getAvailableMaterialColumns();
  const { contributors, tags, ...material } = parsed.data;
  const { data, error } = await supabaseAdmin
    .from('materials')
    .update({
      ...filterMaterialColumns(material, materialColumns),
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to update material', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Material not found');
  }

  try {
    if (contributors) {
      await replaceContributors(data.id, contributors);
    }
    if (tags) {
      await replaceTags(data.id, tags);
    }
  } catch (syncError) {
    return sendError(res, 500, 'Material updated but related data could not be saved', syncError instanceof Error ? syncError.message : 'Unknown error');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'catalog.update',
    entityType: 'material',
    entityId: data.id,
    metadata: {
      title: data.title,
      changed_fields: Object.keys(parsed.data)
    }
  });

  return res.json({ material: data });
});

catalogRouter.delete('/materials/:id', requireAuth, requireAnyPermission('catalog:delete'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive material', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Material not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'catalog.archive',
    entityType: 'material',
    entityId: data.id,
    metadata: { title: data.title }
  });

  return res.json({ material: data });
});

catalogRouter.get('/materials/:id/copies', requireAuth, requireAnyPermission('catalog:read'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('material_copies')
    .select('*')
    .eq('material_id', req.params.id)
    .order('created_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load copies', error.message);
  }

  return res.json({ items: data ?? [] });
});

catalogRouter.get('/copies/:id', requireAuth, requireAnyPermission('catalog:read'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('material_copies')
    .select('*, materials(id,title,kind)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load copy', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Copy not found');
  }

  return res.json({ copy: data });
});

catalogRouter.post('/materials/:id/copies', requireAuth, requireAnyPermission('catalog:update'), async (req: AuthedRequest, res) => {
  const parsed = copySchema.safeParse({ ...req.body, material_id: req.params.id });
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid copy payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin.from('material_copies').insert(parsed.data).select('*').single();
  if (error) {
    return sendError(res, 500, 'Unable to create copy', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'catalog.copy.create',
    entityType: 'material_copy',
    entityId: data.id,
    metadata: { material_id: data.material_id, status: data.status }
  });

  return res.status(201).json({ copy: data });
});

catalogRouter.patch('/copies/:id', requireAuth, requireAnyPermission('catalog:update'), async (req: AuthedRequest, res) => {
  const parsed = copySchema.omit({ material_id: true }).partial().safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid copy payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('material_copies')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to update copy', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Copy not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'catalog.copy.update',
    entityType: 'material_copy',
    entityId: data.id,
    metadata: { material_id: data.material_id, status: data.status }
  });

  return res.json({ copy: data });
});

catalogRouter.delete('/copies/:id', requireAuth, requireAnyPermission('catalog:update'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('material_copies')
    .update({
      status: 'archived',
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive copy', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Copy not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'catalog.copy.archive',
    entityType: 'material_copy',
    entityId: data.id,
    metadata: { material_id: data.material_id, status: data.status }
  });

  return res.json({ copy: data });
});
