import prisma from "@/lib/database/prisma";
import type { AgentContext } from "../family/index";

// ──────────────────────────────────────────────
// Merchant config
// ──────────────────────────────────────────────

// GDU group (Devoto/Disco/Geant) uses a Blazor Server app with no public REST API.
// Mercado Libre Uruguay has a REST API but requires OAuth.
// For now we generate deep search links — the user clicks and sees prices themselves.
// Price comparison via API is planned once ML OAuth tokens are configured.

// ML Uruguay search URLs: use _Buscar_ keyword format (same as typing in ML's search box)
// Spaces → +, strip quantities from name first
const mlSearchQuery = (q: string) => q.trim().replace(/\s+/g, "+");

// Strip trailing quantities/units from a product name before searching
// e.g. "cebolla 2 unidades" → "cebolla", "leche entera 1L" → "leche entera"
const normalizeProductName = (name: string) =>
  name
    .replace(/\s+\d+[\s,.]?\d*\s*(kg|g|mg|ml|l|litros?|cc|un|unidades?|paq|paquetes?)\.?\s*$/i, "")
    .replace(/\s+x\s*\d+.*$/i, "")
    .trim();

const MERCHANT_CONFIG = {
  DEVOTO: {
    name: "Devoto",
    searchUrl: (q: string) =>
      `https://listado.mercadolibre.com.uy/supermercado-devoto/_Buscar_${mlSearchQuery(q)}`,
  },
  DISCO: {
    name: "Disco",
    searchUrl: (q: string) =>
      `https://listado.mercadolibre.com.uy/supermercado-disco/_Buscar_${mlSearchQuery(q)}`,
  },
  GEANT: {
    name: "Geant",
    searchUrl: (q: string) =>
      `https://listado.mercadolibre.com.uy/supermercado-geant/_Buscar_${mlSearchQuery(q)}`,
  },
  TIENDA_INGLESA: {
    name: "Tienda Inglesa",
    searchUrl: (q: string) =>
      `https://listado.mercadolibre.com.uy/supermercado-tienda-inglesa/_Buscar_${mlSearchQuery(q)}`,
  },
} as const;

export type MerchantKey = keyof typeof MERCHANT_CONFIG;

const ALL_MERCHANTS = Object.keys(MERCHANT_CONFIG) as MerchantKey[];

// Shape returned per merchant per search term
export interface MerchantSearchLink {
  merchantId: MerchantKey;
  name: string;
  searchUrl: string;
}

// ──────────────────────────────────────────────
// Tools
// ──────────────────────────────────────────────

/**
 * Returns search links for a product across all enabled merchants.
 * The user clicks to see real-time prices and stock.
 * (Server-side price lookup is blocked by Blazor SSR + no public API.)
 */
export async function searchMerchantProductsTool(
  args: { query: string; merchantIds?: MerchantKey[] },
  ctx: AgentContext,
) {
  const connectors = await prisma.merchantConnector.findMany({
    where: { householdId: ctx.householdId, enabled: true },
    select: { merchantId: true },
  });

  const activeMerchants: MerchantKey[] =
    connectors.length > 0 ? (connectors.map((c) => c.merchantId) as MerchantKey[]) : ALL_MERCHANTS;

  const toSearch = args.merchantIds ?? activeMerchants;

  // Normalize query: strip trailing quantities like "leche 1L", "carne 500g", "cebolla 2 unidades"
  const normalizedQuery = normalizeProductName(args.query);

  const links: MerchantSearchLink[] = toSearch.map((merchantId) => ({
    merchantId,
    name: MERCHANT_CONFIG[merchantId].name,
    searchUrl: MERCHANT_CONFIG[merchantId].searchUrl(normalizedQuery),
  }));

  return {
    query: normalizedQuery,
    note: "Links de busqueda en supermercados. El usuario hace click para ver precios y disponibilidad en tiempo real.",
    merchants: links,
  };
}

/**
 * Generates a combined search page linking all items across chosen merchants.
 * One link per merchant that searches all items together.
 */
export async function buildSearchLinksForListTool(args: {
  items: Array<{ name: string; quantity?: number; unit?: string }>;
  merchantIds?: MerchantKey[];
}) {
  const toUse = args.merchantIds ?? ALL_MERCHANTS;

  const links = toUse.map((merchantId) => ({
    merchantId,
    name: MERCHANT_CONFIG[merchantId].name,
    individualLinks: args.items.map((item) => {
      const cleanName = normalizeProductName(item.name);
      return {
        item: item.name,
        url: MERCHANT_CONFIG[merchantId].searchUrl(cleanName),
      };
    }),
  }));

  return { items: args.items.map((i) => i.name), merchants: links };
}

/**
 * Configure which merchants are enabled for a household.
 */
export async function setMerchantEnabledTool(
  args: { merchantId: MerchantKey; enabled: boolean },
  ctx: AgentContext,
) {
  await prisma.merchantConnector.upsert({
    where: {
      householdId_merchantId: {
        householdId: ctx.householdId,
        merchantId: args.merchantId,
      },
    },
    update: { enabled: args.enabled },
    create: {
      householdId: ctx.householdId,
      merchantId: args.merchantId,
      enabled: args.enabled,
    },
  });

  return {
    merchantId: args.merchantId,
    name: MERCHANT_CONFIG[args.merchantId].name,
    enabled: args.enabled,
  };
}
