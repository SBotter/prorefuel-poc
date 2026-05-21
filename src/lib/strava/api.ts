const BASE = "https://www.strava.com/api/v3";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StravaActivity {
  id:           number;
  name:         string;
  type:         string;
  sport_type:   string;
  start_date:   string;  // UTC ISO
  distance:     number;  // metres
  moving_time:  number;  // seconds
  elapsed_time: number;  // seconds
  total_elevation_gain: number;
  has_heartrate: boolean;
  map: { summary_polyline: string | null };
}

interface StravaStream {
  type: string;
  data: number[] | [number, number][];
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function stravaFetch(path: string, accessToken: string): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: 0 },
  });
  return res;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchActivities(accessToken: string): Promise<StravaActivity[]> {
  const res = await stravaFetch(
    "/athlete/activities?per_page=10&page=1",
    accessToken,
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error("Strava session expired. Please reconnect.");
    throw new Error(`Strava error ${res.status}`);
  }
  return res.json();
}

export async function buildGpxForActivity(
  activityId: number,
  accessToken: string,
): Promise<string> {
  // Fetch activity details and streams in parallel
  const [actRes, streamsRes] = await Promise.all([
    stravaFetch(`/activities/${activityId}`, accessToken),
    stravaFetch(
      `/activities/${activityId}/streams?keys=latlng,altitude,time,heartrate,cadence,watts`,
      accessToken,
    ),
  ]);

  if (!actRes.ok) {
    if (actRes.status === 401) throw new Error("Strava session expired. Please reconnect.");
    throw new Error(`Failed to fetch activity: ${actRes.status}`);
  }
  if (!streamsRes.ok) {
    throw new Error(`Failed to fetch activity streams: ${streamsRes.status}`);
  }

  const activity: StravaActivity = await actRes.json();
  const streams: StravaStream[]  = await streamsRes.json();

  return buildGpx(activity, streams);
}

// ── GPX builder ───────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildGpx(activity: StravaActivity, streams: StravaStream[]): string {
  // Build a map from stream type → data array
  const sm: Record<string, number[]> = {};
  for (const s of streams) {
    sm[s.type] = s.data as number[];
  }

  const latlng    = sm["latlng"]    as unknown as [number, number][] | undefined;
  const altitude  = sm["altitude"];
  const time      = sm["time"];
  const heartrate = sm["heartrate"];
  const cadence   = sm["cadence"];
  const watts     = sm["watts"];

  if (!latlng || latlng.length === 0) {
    throw new Error(
      "This activity has no GPS data. Only outdoor activities recorded with GPS can be used in LENS."
    );
  }

  const startMs = new Date(activity.start_date).getTime();

  const trkpts = latlng.map(([lat, lon], i) => {
    const ele     = altitude?.[i];
    const tOffset = time?.[i] ?? i;
    const ts      = new Date(startMs + tOffset * 1000).toISOString();
    const hr      = heartrate?.[i];
    const cad     = cadence?.[i];
    const pwr     = watts?.[i];

    const eleTag  = ele  !== undefined ? `\n        <ele>${ele.toFixed(1)}</ele>` : "";

    let ext = "";
    if (hr !== undefined || cad !== undefined || pwr !== undefined) {
      ext  = "\n        <extensions>\n          <gpxtpx:TrackPointExtension>";
      if (hr  !== undefined) ext += `\n            <gpxtpx:hr>${Math.round(hr)}</gpxtpx:hr>`;
      if (cad !== undefined) ext += `\n            <gpxtpx:cad>${Math.round(cad)}</gpxtpx:cad>`;
      if (pwr !== undefined) ext += `\n            <power>${Math.round(pwr)}</power>`;
      ext += "\n          </gpxtpx:TrackPointExtension>\n        </extensions>";
    }

    return `      <trkpt lat="${lat}" lon="${lon}">${eleTag}\n        <time>${ts}</time>${ext}\n      </trkpt>`;
  });

  const sportType = (activity.sport_type || activity.type || "cycling").toLowerCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LENS by ProRefuel — Strava import"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>${escapeXml(activity.name)}</name>
    <type>${sportType}</type>
    <trkseg>
${trkpts.join("\n")}
    </trkseg>
  </trk>
</gpx>`;
}
