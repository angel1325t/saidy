import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRoles, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const catalogRouter = Router();

const listQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12)
});

catalogRouter.get('/overview', requireAuth, async (_req, res) => {
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

catalogRouter.get('/materials', requireAuth, async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid catalog filters', parsed.error.flatten());
  }

  const { q, type, tag, page, limit } = parsed.data;
  let query = supabaseAdmin
    .from('materials')
    .select('id,kind,title,subtitle,summary,publisher,publication_year,language,isbn,doi,cover_url,digital_url,keywords,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (q) {
    query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%,publisher.ilike.%${q}%`);
  }

  if (type) {
    query = query.eq('kind', type);
  }

  const { data, error, count } = await query;
  if (error) {
    return sendError(res, 500, 'Unable to load materials', error.message);
  }

  let materials = data ?? [];
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

catalogRouter.get('/materials/:id', requireAuth, async (req, res) => {
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

const materialSchema = z.object({
  kind: z.enum([
    'physical_book',
    'ebook',
    'magazine',
    'journal_article',
    'thesis',
    'audiobook',
    'multimedia'
  ]),
  title: z.string().min(2).max(200),
  subtitle: z.string().max(200).optional().nullable(),
  summary: z.string().min(10).max(4000).optional().nullable(),
  publisher: z.string().max(180).optional().nullable(),
  publication_year: z.coerce.number().int().min(0).max(2100).optional().nullable(),
  language: z.string().max(40).optional().nullable(),
  isbn: z.string().max(32).optional().nullable(),
  doi: z.string().max(120).optional().nullable(),
  cover_url: z.string().url().optional().nullable(),
  digital_url: z.string().url().optional().nullable(),
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

catalogRouter.post('/', requireAuth, requireRoles('admin', 'librarian'), async (req: AuthedRequest, res) => {
  const parsed = materialSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid material payload', parsed.error.flatten());
  }

  const { contributors, tags, ...material } = parsed.data;
  const { data: inserted, error } = await supabaseAdmin
    .from('materials')
    .insert({
      ...material,
      created_by: req.auth!.userId,
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create material', error.message);
  }

  if (contributors.length > 0) {
    await supabaseAdmin.from('material_contributors').insert(
      contributors.map((contributor) => ({
        material_id: inserted.id,
        ...contributor
      }))
    );
  }

  if (tags.length > 0) {
    await supabaseAdmin.from('tags').upsert(tags.map((name) => ({ name })), { onConflict: 'name' });
    const { data: tagData } = await supabaseAdmin.from('tags').select('id,name').in('name', tags);
    await supabaseAdmin.from('material_tags').insert(
      (tagData ?? []).map((tagRow) => ({
        material_id: inserted.id,
        tag_id: tagRow.id
      }))
    );
  }

  return res.status(201).json({ material: inserted });
});
