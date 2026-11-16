import { Masthead } from '../books/Masthead';
import type { DiscoverResponse } from '../lib/types';

/**
 * The magazine issue line under the header: week and date, the weekly pick, the catalogue size.
 * Masthead draws it full width, like the header, so the text rule runs edge to edge.
 */
export function IssueLine({ issue }: { issue: DiscoverResponse['issue'] }) {
  return <Masthead issue={issue} />;
}
