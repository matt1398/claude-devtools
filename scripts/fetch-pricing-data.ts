#!/usr/bin/env tsx

/**
 * Fetch latest model pricing from LiteLLM and save to renderer assets.
 * Filters to Claude models only to reduce bundle size.
 * Runs automatically during prebuild.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'resources', 'pricing.json');
const FETCH_TIMEOUT = 10000; // 10 seconds

interface ModelPricing {
  input_cost_per_token: number;
  output_cost_per_token: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;
  [key: string]: unknown;
}

function isValidModelPricing(entry: unknown): entry is ModelPricing {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'input_cost_per_token' in entry &&
    'output_cost_per_token' in entry &&
    typeof (entry as ModelPricing).input_cost_per_token === 'number' &&
    typeof (entry as ModelPricing).output_cost_per_token === 'number'
  );
}

function isClaudeModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  return lower.includes('claude');
}

async function fetchPricingData(): Promise<Record<string, ModelPricing>> {
  console.log('Fetching pricing data from LiteLLM...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(LITELLM_PRICING_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    console.log(`Fetched pricing for ${Object.keys(data).length} models`);

    // Filter to Claude models only and validate entries
    const claudeModels: Record<string, ModelPricing> = {};
    for (const [modelName, entry] of Object.entries(data)) {
      if (isClaudeModel(modelName) && isValidModelPricing(entry)) {
        claudeModels[modelName] = entry;
      }
    }

    console.log(`Filtered to ${Object.keys(claudeModels).length} Claude models`);
    return claudeModels;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Fetch timeout after 10 seconds');
    }
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    console.log('Fetching pricing data for models...');
    const pricing = await fetchPricingData();

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write formatted JSON
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(pricing, null, 2), 'utf-8');

    // Calculate file size
    const stats = fs.statSync(OUTPUT_PATH);
    const sizeKB = (stats.size / 1024).toFixed(2);

    console.log(`✓ Wrote pricing data to ${OUTPUT_PATH}`);
    console.log(`  Bundle size: ${sizeKB} KB`);
  } catch (error) {
    console.error('Failed to fetch pricing data:', error);
    console.error('Build will continue with existing pricing.json if available');
    // Don't fail the build - allow using existing pricing.json
    process.exit(0);
  }
}

main();
