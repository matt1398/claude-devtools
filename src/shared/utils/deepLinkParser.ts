/**
 * Deep link URL parser for claude-devtools:// protocol.
 *
 * Parses custom URL scheme into typed navigation actions.
 * Pure logic with no Node.js or DOM dependencies.
 */

// =============================================================================
// Types
// =============================================================================

export type SettingsSection = 'general' | 'connection' | 'workspace' | 'notifications' | 'advanced';

export type DeepLinkNavigation =
  | { type: 'dashboard' }
  | { type: 'session'; projectId: string; sessionId: string; subagentId?: string }
  | { type: 'notifications'; filter?: string }
  | { type: 'settings'; section: SettingsSection }
  | { type: 'search'; query: string }
  | { type: 'unknown'; raw: string };

export interface DeepLinkParseResult {
  success: boolean;
  navigation: DeepLinkNavigation;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

const PROTOCOL = 'claude-devtools://';

const VALID_SETTINGS_SECTIONS: ReadonlySet<string> = new Set([
  'general',
  'connection',
  'workspace',
  'notifications',
  'advanced',
]);

// =============================================================================
// Parser
// =============================================================================

/**
 * Parse a claude-devtools:// URL into a typed navigation action.
 */
export function parseDeepLinkUrl(rawUrl: string): DeepLinkParseResult {
  const trimmed = rawUrl.trim();

  if (!trimmed.startsWith(PROTOCOL)) {
    return {
      success: false,
      navigation: { type: 'unknown', raw: trimmed },
      error: 'URL must start with claude-devtools://',
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed.replace(PROTOCOL, 'https://'));
  } catch {
    return {
      success: false,
      navigation: { type: 'unknown', raw: trimmed },
      error: 'Malformed URL',
    };
  }

  // hostname is the first path segment for custom protocols
  // pathname segments are everything after
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const allSegments = [url.hostname, ...pathSegments];

  if (!allSegments[0]) {
    return {
      success: false,
      navigation: { type: 'unknown', raw: trimmed },
      error: 'Empty URL',
    };
  }

  const route = allSegments[0].toLowerCase();

  switch (route) {
    case 'dashboard':
      return { success: true, navigation: { type: 'dashboard' } };

    case 'session': {
      const projectId = allSegments[1] ? decodeURIComponent(allSegments[1]) : undefined;
      const sessionId = allSegments[2] ? decodeURIComponent(allSegments[2]) : undefined;

      if (!projectId || !sessionId) {
        return {
          success: false,
          navigation: { type: 'unknown', raw: trimmed },
          error: 'Session URL requires projectId and sessionId',
        };
      }

      let subagentId: string | undefined;
      if (allSegments[3]?.toLowerCase() === 'subagent' && allSegments[4]) {
        subagentId = decodeURIComponent(allSegments[4]);
      }

      return {
        success: true,
        navigation: { type: 'session', projectId, sessionId, subagentId },
      };
    }

    case 'notifications': {
      const filter = url.searchParams.get('filter') ?? undefined;
      return { success: true, navigation: { type: 'notifications', filter } };
    }

    case 'settings': {
      const sectionRaw = allSegments[1]?.toLowerCase();
      const section =
        sectionRaw && VALID_SETTINGS_SECTIONS.has(sectionRaw)
          ? (sectionRaw as SettingsSection)
          : 'general';
      return { success: true, navigation: { type: 'settings', section } };
    }

    case 'search': {
      const query = url.searchParams.get('q') ?? '';
      return { success: true, navigation: { type: 'search', query } };
    }

    default:
      return {
        success: false,
        navigation: { type: 'unknown', raw: trimmed },
        error: `Unknown route: ${route}`,
      };
  }
}
