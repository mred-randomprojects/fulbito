import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addVideo,
  embedUrl,
  extractAddress,
  hasVideo,
  parseTimestamp,
  parseVideoUrl,
  removeVideo,
  setVideoLabel,
  thumbnailUrl,
  videoLines,
  videoSource,
  videoTitle,
  type MatchVideo,
  type VideoEmbed,
} from "./video.js";

const YT: VideoEmbed = { kind: "youtube", id: "dQw4w9WgXcQ", start: 0 };

describe("recognising a YouTube link", () => {
  it("reads the watch page, the short link, shorts, live and embed", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      assert.deepEqual(parseVideoUrl(url), YT, url);
    }
  });

  it("carries the timestamp, in the shapes YouTube writes it", () => {
    assert.deepEqual(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=90"), { ...YT, start: 90 });
    assert.deepEqual(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=1m30s"), { ...YT, start: 90 });
    assert.deepEqual(parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ?start=45"), {
      ...YT,
      start: 45,
    });
  });

  it("is a plain link when the page is not a video", () => {
    // A channel or a playlist is a working address, just not one with a
    // player behind it. Decision 1: kept, not embedded.
    assert.equal(parseVideoUrl("https://www.youtube.com/@somechannel")?.kind, "link");
    assert.equal(parseVideoUrl("https://www.youtube.com/watch?v=short")?.kind, "link");
  });

  it("embeds through the no-cookie host, from the timestamp", () => {
    assert.equal(embedUrl(YT), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    assert.equal(
      embedUrl({ ...YT, start: 90 }),
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90",
    );
    assert.equal(thumbnailUrl(YT), "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
});

describe("recognising the other hosts", () => {
  it("reads a Vimeo link, with the unlisted key either way it is written", () => {
    assert.deepEqual(parseVideoUrl("https://vimeo.com/123456789"), {
      kind: "vimeo",
      id: "123456789",
      hash: null,
      start: 0,
    });
    assert.deepEqual(parseVideoUrl("https://vimeo.com/123456789/abcdef0123"), {
      kind: "vimeo",
      id: "123456789",
      hash: "abcdef0123",
      start: 0,
    });
    assert.deepEqual(parseVideoUrl("https://player.vimeo.com/video/123456789?h=abcdef0123#t=1m"), {
      kind: "vimeo",
      id: "123456789",
      hash: "abcdef0123",
      start: 60,
    });
    assert.equal(
      embedUrl({ kind: "vimeo", id: "123456789", hash: "abcdef0123", start: 60 }),
      "https://player.vimeo.com/video/123456789?h=abcdef0123#t=60s",
    );
    assert.equal(
      embedUrl({ kind: "vimeo", id: "123456789", hash: null, start: 0 }),
      "https://player.vimeo.com/video/123456789",
    );
  });

  it("reads a Google Drive share and embeds its preview", () => {
    const drive = parseVideoUrl(
      "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view?usp=sharing",
    );
    assert.deepEqual(drive, { kind: "drive", id: "1aBcDeFgHiJkLmNoPqRsTuVwXyZ" });
    assert.equal(
      embedUrl({ kind: "drive", id: "1aBcDeFgHiJkLmNoPqRsTuVwXyZ" }),
      "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/preview",
    );
    assert.deepEqual(parseVideoUrl("https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ"), {
      kind: "drive",
      id: "1aBcDeFgHiJkLmNoPqRsTuVwXyZ",
    });
  });

  it("plays a bare video file itself, and has no frame for it", () => {
    const file = parseVideoUrl("https://cdn.example.com/partidos/jueves.MP4?token=1");
    assert.deepEqual(file, { kind: "file", url: "https://cdn.example.com/partidos/jueves.MP4?token=1" });
    assert.equal(embedUrl({ kind: "file", url: "https://x/y.mp4" }), null);
  });

  it("keeps any other working address as a link", () => {
    // The venue's own viewer. Decision 1.
    const link = parseVideoUrl("https://app.lacancha.com.ar/partidos/8812");
    assert.deepEqual(link, { kind: "link", url: "https://app.lacancha.com.ar/partidos/8812" });
    assert.equal(embedUrl(link), null);
    assert.equal(thumbnailUrl(link), null);
    assert.equal(videoSource(link), "app.lacancha.com.ar");
  });
});

describe("what is not an address", () => {
  it("refuses prose, blanks, and anything that is not http", () => {
    for (const raw of ["", "   ", "el video lo tiene Juan", "javascript:alert(1)", "file:///tmp/x.mp4", "mailto:a@b.c"]) {
      assert.equal(parseVideoUrl(raw), null, JSON.stringify(raw));
    }
  });

  it("puts a scheme on a bare host, and only on a bare host", () => {
    // Decision 2: typed links have no `https://`; pasted ones do.
    assert.deepEqual(parseVideoUrl("youtu.be/dQw4w9WgXcQ"), YT);
    assert.deepEqual(parseVideoUrl("  www.youtube.com/watch?v=dQw4w9WgXcQ  "), YT);
    assert.equal(parseVideoUrl("dQw4w9WgXcQ"), null);
    assert.equal(parseVideoUrl("cancha 5"), null);
  });
});

describe("a link inside a sentence", () => {
  it("is the link, without the sentence's full stop", () => {
    // Decision 5: the whole message from the chat, pasted as is.
    assert.equal(
      extractAddress("acá está el video https://youtu.be/dQw4w9WgXcQ. golazo del Gordo"),
      "https://youtu.be/dQw4w9WgXcQ",
    );
    assert.deepEqual(parseVideoUrl("mirá: https://youtu.be/dQw4w9WgXcQ?t=90"), { ...YT, start: 90 });
  });

  it("finds a bare link to a host it knows, the way the chat writes them", () => {
    assert.equal(
      extractAddress("mirá el gol: youtu.be/dQw4w9WgXcQ?t=2052 golazo"),
      "https://youtu.be/dQw4w9WgXcQ?t=2052",
    );
    assert.equal(extractAddress("está en drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view, fijate"),
      "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view");
    // Not for hosts it does not know: a dot in a sentence is not a link.
    assert.equal(extractAddress("nos vemos a las 21.30hs en la cancha"), null);
    assert.equal(extractAddress("el video está en lacancha.com.ar/partidos/8812"), null);
  });

  it("stores the link and not the sentence", () => {
    assert.deepEqual(addVideo([], "el video https://youtu.be/dQw4w9WgXcQ"), [
      { url: "https://youtu.be/dQw4w9WgXcQ", label: "" },
    ]);
  });

  it("is nothing when the sentence has no link in it", () => {
    assert.equal(extractAddress("el video lo tiene Juan"), null);
    assert.equal(extractAddress("youtu.be está caído"), null);
  });
});

describe("reading a timestamp", () => {
  it("takes seconds, units and the clock", () => {
    assert.equal(parseTimestamp("90"), 90);
    assert.equal(parseTimestamp("90s"), 90);
    assert.equal(parseTimestamp("1m30s"), 90);
    assert.equal(parseTimestamp("1h2m3s"), 3723);
    assert.equal(parseTimestamp("2m"), 120);
    assert.equal(parseTimestamp("1:30"), 90);
    assert.equal(parseTimestamp("1:02:03"), 3723);
  });

  it("is the start for anything it cannot read", () => {
    assert.equal(parseTimestamp(null), 0);
    assert.equal(parseTimestamp(""), 0);
    assert.equal(parseTimestamp("later"), 0);
    assert.equal(parseTimestamp("-5"), 0);
  });
});

describe("adding a video", () => {
  it("appends a trimmed address with no label", () => {
    const next = addVideo([], "  https://youtu.be/dQw4w9WgXcQ \n");
    assert.deepEqual(next, [{ url: "https://youtu.be/dQw4w9WgXcQ", label: "" }]);
  });

  it("stores a bare host with its scheme, so the link does not point into the app", () => {
    assert.deepEqual(addVideo([], "youtu.be/dQw4w9WgXcQ"), [
      { url: "https://youtu.be/dQw4w9WgXcQ", label: "" },
    ]);
  });

  it("hands back the same list for something that is not an address", () => {
    const videos: MatchVideo[] = [];
    assert.equal(addVideo(videos, "el video lo tiene Juan"), videos);
  });

  it("hands back the same list for a video already there, however it is written", () => {
    // Decision 3: the recogniser decides, not the string.
    const videos = addVideo([], "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(addVideo(videos, "https://youtu.be/dQw4w9WgXcQ"), videos);
    assert.equal(addVideo(videos, "youtu.be/dQw4w9WgXcQ?si=share"), videos);
  });

  it("says whether an address is already there, however it is written", () => {
    const videos = addVideo([], "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(hasVideo(videos, "youtu.be/dQw4w9WgXcQ"), true);
    assert.equal(hasVideo(videos, "https://youtu.be/dQw4w9WgXcQ?t=10"), false);
    assert.equal(hasVideo(videos, "no es un link"), false);
  });

  it("takes the same video at another timestamp as another video", () => {
    // That is what "el gol del Gordo" is: the same recording, a minute in.
    const videos = addVideo([], "https://youtu.be/dQw4w9WgXcQ");
    assert.equal(addVideo(videos, "https://youtu.be/dQw4w9WgXcQ?t=2052").length, 2);
  });

  it("dedupes an unrecognised link on the address alone", () => {
    const videos = addVideo([], "https://app.lacancha.com.ar/partidos/8812");
    assert.equal(addVideo(videos, "https://app.lacancha.com.ar/partidos/8812"), videos);
    assert.equal(addVideo(videos, "https://app.lacancha.com.ar/partidos/8813").length, 2);
  });
});

describe("labelling and removing", () => {
  const two: MatchVideo[] = [
    { url: "https://youtu.be/dQw4w9WgXcQ", label: "" },
    { url: "https://youtu.be/dQw4w9WgXcQ?t=2052", label: "gol" },
  ];

  it("keeps the label exactly as typed", () => {
    // Decision 4: trimming as you go makes a space impossible to type.
    assert.equal(setVideoLabel(two, 0, " primer tiempo ")[0].label, " primer tiempo ");
    assert.equal(setVideoLabel(two, 0, " primer tiempo ")[1], two[1]);
  });

  it("calls a video by its label, or by where it is when there is none", () => {
    assert.equal(videoTitle(two[1], YT), "gol");
    assert.equal(videoTitle(two[0], YT), "YouTube");
    assert.equal(videoTitle({ url: "", label: "   " }, YT), "YouTube");
  });

  it("removes by position and ignores a position that is not there", () => {
    assert.deepEqual(removeVideo(two, 0), [two[1]]);
    assert.equal(removeVideo(two, 2), two);
    assert.equal(removeVideo(two, -1), two);
    assert.equal(setVideoLabel(two, 5, "x"), two);
  });
});

describe("the lines for the chat", () => {
  it("is one line per video, the label leading when there is one", () => {
    assert.deepEqual(
      videoLines([
        { url: "https://youtu.be/dQw4w9WgXcQ", label: "" },
        { url: "https://youtu.be/dQw4w9WgXcQ?t=2052", label: " Gol del Gordo " },
      ]),
      ["🎥 https://youtu.be/dQw4w9WgXcQ", "🎥 Gol del Gordo: https://youtu.be/dQw4w9WgXcQ?t=2052"],
    );
  });

  it("skips a stored address that is not one, and says nothing with no videos", () => {
    // A hand-edited blob is the only way that happens; a line with no link
    // in it would be the chat's problem to work out.
    assert.deepEqual(videoLines([{ url: "no es un link", label: "x" }]), []);
    assert.deepEqual(videoLines([]), []);
  });
});
