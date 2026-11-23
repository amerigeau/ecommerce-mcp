import { z } from "zod";

export const moneySchema = z.object({
  amount: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const productSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  sku: z.string().nullable(),
  price: moneySchema,
  stockQuantity: z.number().int().nullable(),
  status: z.string(),
});

export const productSchema = productSummarySchema.extend({
  description: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  permalink: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const orderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  total: moneySchema,
  customerEmail: z.string().nullable(),
  createdAt: z.string(),
  lineItems: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number().int().nonnegative(),
      total: moneySchema,
    }),
  ),
});

export const stockItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string().nullable(),
  stockQuantity: z.number().int(),
  lowStockThreshold: z.number().int().nonnegative(),
});

export const searchInputSchema = z.object({
  query: z.string().optional().describe("Name or SKU fragment. Omit to list products."),
  limit: z.number().int().min(1).max(50).optional().describe("Max results. Default 20."),
});

export const searchOutputSchema = z.object({
  products: z.array(productSummarySchema),
});

export const idInputSchema = z.object({
  id: z.string().min(1),
});

export const productOutputSchema = z.object({
  product: productSchema,
});

export const orderOutputSchema = z.object({
  order: orderSchema,
});

export const lowStockInputSchema = z.object({
  threshold: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .optional()
    .describe("Quantity at or below this counts. Default 5."),
  limit: z.number().int().min(1).max(50).optional().describe("Max rows. Default 20."),
});

export const lowStockOutputSchema = z.object({
  threshold: z.number().int(),
  items: z.array(stockItemSchema),
});

export const fieldDiffSchema = z
  .object({
    price: z.string().optional(),
    seoTitle: z.string().nullable().optional(),
    seoDescription: z.string().nullable().optional(),
    stockQuantity: z.number().int().nullable().optional(),
  })
  .strict();

export const previewInputSchema = z
  .object({
    productId: z.string().min(1).describe("Product id from search_products or get_product."),
    kind: z.enum(["price", "seo", "stock"]),
    price: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional()
      .describe("Required when kind is price."),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(320).optional(),
    stockQuantity: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .optional()
      .describe("Required when kind is stock."),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "price" && value.price === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["price"],
        message: "price is required when kind is price",
      });
    }
    if (
      value.kind === "seo" &&
      value.seoTitle === undefined &&
      value.seoDescription === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seoTitle"],
        message: "seoTitle or seoDescription is required when kind is seo",
      });
    }
    if (value.kind === "stock" && value.stockQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stockQuantity"],
        message: "stockQuantity is required when kind is stock",
      });
    }
  });

export const previewFieldsSchema = z.object({
  productId: z.string().min(1),
  kind: z.enum(["price", "seo", "stock"]),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(320).optional(),
  stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
});

export const previewOutputSchema = z.object({
  changeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  productId: z.string(),
  kind: z.enum(["price", "seo", "stock"]),
  before: fieldDiffSchema,
  after: fieldDiffSchema,
  lockedUpdatedAt: z.string().nullable(),
});

export const applyInputSchema = z.object({
  changeId: z.string().uuid(),
});

export const applyOutputSchema = z.object({
  changeId: z.string().uuid(),
  verified: z.boolean(),
  product: productSchema,
});

export type ProductSummary = z.infer<typeof productSummarySchema>;
export type Product = z.infer<typeof productSchema>;
export type Order = z.infer<typeof orderSchema>;
export type StockItem = z.infer<typeof stockItemSchema>;
export type FieldDiff = z.infer<typeof fieldDiffSchema>;
export type PreviewInput = z.infer<typeof previewInputSchema>;
export type PreviewResult = z.infer<typeof previewOutputSchema>;
export type ApplyResult = z.infer<typeof applyOutputSchema>;
