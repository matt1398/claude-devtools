/**
 * Deep link URL parser for claude-devtools:// protocol.
 *
 * Parses custom URL scheme into typed navigation actions.
 * Pure logic with no Node.js or DOM dependencies.
 *
 * Supported routes:
 *   claude-devtools://projects                                                            → projects list
 *   claude-devtools://projects?q={query}                                                  → projects list, search pre-filled
 *   claude-devtools://projects/{project_name}                                             → specific project selected
 *   claude-devtools://projects/{project_name}?q={query}                                  → project selected, session search pre-filled
 *   claude-devtools://projects/{project_name}/sessions/{sessionId}                       → session
 *   claude-devtools://projects/{project_name}/sessions/{sessionId}/subagents/{subagentId} → subagent
 *   claude-devtools://notifications                                                       → notifications tab
 *   claude-devtools://settings/{section}                                                  → settings tab
 */

// =============================================================================
// Types
// =============================================================================

export type SettingsSection = 'general' | 'connection' | 'workspace' | 'notifications' | 'advanced';

export type DeepLinkNavigation =
  | { type: 'projects'; projectName?: string; query?: string }
  | { type: 'session'; projectName: string; sessionId: string; subagentId?: string }
  | { type: 'notifications'; filter?: string }
  | { type: 'settings'; section: SettingsSection }
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
  'advanced',
  'connection',
  'general',
  'notifications',
  'workspace',
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

  // hostname is the first path segment for custom protocols;
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
    case 'projects': {
      // Decode the project name from segment [1] (if present)
      const projectName = allSegments[1] ? decodeURIComponent(allSegments[1]) : undefined;

      // Sub-path: projects/{name}/sessions/{id}[/subagents/{aid}]
      if (allSegments[2]?.toLowerCase() === 'sessions') {
        const sessionId = allSegments[3] ? decodeURIComponent(allSegments[3]) : undefined;

        if (!projectName || !sessionId) {
          return {
            success: false,
            navigation: { type: 'unknown', raw: trimmed },
            error: 'Session URL requires projectName and sessionId',
          };
        }

        let subagentId: string | undefined;
        if (allSegments[4]?.toLowerCase() === 'subagents' && allSegments[5]) {
          subagentId = decodeURIComponent(allSegments[5]);
        }

        return {
          success: true,
          navigation: {
            type: 'session',
            projectName,
            sessionId,
            ...(subagentId !== undefined && { subagentId }),
          },
        };
      }

      // Sub-path: projects[/{name}][?q=...]
      const queryRaw = url.searchParams.get('q');
      const query = queryRaw !== null && queryRaw.length > 0 ? queryRaw : undefined;

      return {
        success: true,
        navigation: {
          type: 'projects',
          ...(projectName !== undefined && { projectName }),
          ...(query !== undefined && { query }),
        },
      };
    }

    case 'notifications': {
      const filter = url.searchParams.get('filter') ?? undefined;
      return {
        success: true,
        navigation: {
          type: 'notifications',
          ...(filter !== undefined && { filter }),
        },
      };
    }

    case 'settings': {
      const sectionRaw = allSegments[1]?.toLowerCase();
      const section =
        sectionRaw && VALID_SETTINGS_SECTIONS.has(sectionRaw)
          ? (sectionRaw as SettingsSection)
          : 'general';
      return { success: true, navigation: { type: 'settings', section } };
    }

    default:
      return {
        success: false,
        navigation: { type: 'unknown', raw: trimmed },
        error: `Unknown route: ${route}`,
      };
  }
}
