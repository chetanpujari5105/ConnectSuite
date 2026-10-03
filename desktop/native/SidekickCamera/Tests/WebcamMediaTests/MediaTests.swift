import CoreMedia
import CoreVideo
import Foundation
import Testing
@testable import WebcamCore
@testable import WebcamMedia
import WebcamTestSupport

// Everything here is real VideoToolbox / CoreVideo / CoreMedia: generated pictures, encoded by
// VTCompressionSession, decoded by VTDecompressionSession, rotated by VTPixelRotationSession, fitted
// by VTPixelTransferSession.

let BG: ClosedRange<Double> = 95...125      // the pattern's grey (110) after a codec round trip
let MARK: ClosedRange<Double> = 215...255   // the marker (235)
let BAR: ClosedRange<Double> = 10...22      // black (16)

@Suite struct Decode {
    @Test func realH264DecodesToIOSurfaceNV12AtTheCodedSize() throws {
        let enc = try TestH264Encoder(width: 1280, height: 720)
        let (annexB, idr) = try enc.encode(try TestPatterns.marked(width: 1280, height: 720), ptsMicros: 1)
        #expect(idr)
        #expect(WebcamAUCodec.nalUnitTypes(annexB)?.contains(7) == true)
        let pb = try H264Decoder().decode(annexB: annexB, ptsMicros: 1)
        #expect(CVPixelBufferGetWidth(pb) == 1280 && CVPixelBufferGetHeight(pb) == 720)
        #expect(CVPixelBufferGetPixelFormatType(pb) == PublishedFormat.pixelFormat)
        #expect(PixelBuffers.isIOSurfaceBacked(pb))
        #expect(MARK.contains(PixelBuffers.meanLuma(pb, x: 100, y: 100, w: 200, h: 100)))
        #expect(BG.contains(PixelBuffers.meanLuma(pb, x: 900, y: 500, w: 200, h: 100)))
    }

    @Test func aPFrameWithNoParameterSetsIsRefusedNotGuessed() throws {
        let enc = try TestH264Encoder(width: 640, height: 360)
        _ = try enc.encode(try TestPatterns.marked(width: 640, height: 360), ptsMicros: 1)
        let (p, idr) = try enc.encode(try TestPatterns.marked(width: 640, height: 360), ptsMicros: 2)
        #expect(!idr)
        #expect(throws: DecodeError.noParameterSets) { try H264Decoder().decode(annexB: p, ptsMicros: 2) }
    }

    @Test func newParameterSetsReplaceTheSession() throws {
        let d = H264Decoder()
        for (w, h) in [(1280, 720), (640, 360)] {
            let enc = try TestH264Encoder(width: w, height: h)
            let (a, _) = try enc.encode(try TestPatterns.marked(width: w, height: h), ptsMicros: 1)
            let pb = try d.decode(annexB: a, ptsMicros: 1)
            #expect(CVPixelBufferGetWidth(pb) == w)
        }
        #expect(d.sessionsCreated == 2)
    }
}

/// Where the marker lands, by quadrant of the *picture* (not of the output, which may have bars).
enum Quadrant { case topLeft, topRight, bottomLeft, bottomRight }

func pictureRect(source: (Int, Int), turns: UInt8, out: PublishedFormat) -> (x: Double, y: Double, w: Double, h: Double) {
    let (sw, sh) = turns % 2 == 1 ? (Double(source.1), Double(source.0)) : (Double(source.0), Double(source.1))
    let s = min(Double(out.width) / sw, Double(out.height) / sh)
    let w = sw * s, h = sh * s
    return ((Double(out.width) - w) / 2, (Double(out.height) - h) / 2, w, h)
}

func lumaIn(_ pb: CVPixelBuffer, _ r: (x: Double, y: Double, w: Double, h: Double), _ q: Quadrant) -> Double {
    // A probe box well inside the quadrant, clear of edges and codec ringing.
    let qx = (q == .topRight || q == .bottomRight) ? r.x + r.w * 0.6 : r.x + r.w * 0.15
    let qy = (q == .bottomLeft || q == .bottomRight) ? r.y + r.h * 0.6 : r.y + r.h * 0.15
    return PixelBuffers.meanLuma(pb, x: Int(qx), y: Int(qy), w: Int(r.w * 0.25), h: Int(r.h * 0.25))
}

@Suite struct Compose {
    /// The header's rotation is quarter turns *clockwise* that make the picture upright. The marker
    /// starts top-left; after n clockwise quarter turns it must be where a clockwise turn puts it.
    @Test(arguments: [(UInt8(0), Quadrant.topLeft), (1, .topRight), (2, .bottomRight), (3, .bottomLeft)])
    func rotationIsAppliedClockwiseAndThePictureIsNeverCropped(turns: UInt8, expected: Quadrant) throws {
        let src = try TestPatterns.marked(width: 1280, height: 720)
        let out = try FrameComposer(output: .fullHD).compose(src, quarterTurns: turns)
        #expect(CVPixelBufferGetWidth(out) == 1920 && CVPixelBufferGetHeight(out) == 1080)
        #expect(CVPixelBufferGetPixelFormatType(out) == PublishedFormat.pixelFormat)
        let r = pictureRect(source: (1280, 720), turns: turns, out: .fullHD)
        for q in [Quadrant.topLeft, .topRight, .bottomLeft, .bottomRight] {
            let l = lumaIn(out, r, q)
            #expect((q == expected ? MARK : BG).contains(l), "turns \(turns): quadrant \(q) luma \(l)")
        }
    }

    @Test func aPortraitPictureIsPillarboxedFullHeightWithBlackBars() throws {
        let src = try TestPatterns.marked(width: 720, height: 1280)
        let out = try FrameComposer(output: .fullHD).compose(src, quarterTurns: 0)
        let r = pictureRect(source: (720, 1280), turns: 0, out: .fullHD)
        #expect(abs(r.w - 607.5) < 0.01 && r.h == 1080)
        // Bars: black, full height, both sides.
        #expect(BAR.contains(PixelBuffers.meanLuma(out, x: 0, y: 0, w: 600, h: 1080)))
        #expect(BAR.contains(PixelBuffers.meanLuma(out, x: 1290, y: 0, w: 630, h: 1080)))
        // The picture: top and bottom rows present (not cropped), marker top-left.
        #expect(MARK.contains(PixelBuffers.meanLuma(out, x: 700, y: 4, w: 200, h: 20)))
        #expect(BG.contains(PixelBuffers.meanLuma(out, x: 700, y: 1056, w: 200, h: 20)))
        // Aspect preserved: the non-black span on one row is the picture's width.
        let span = (0..<1920).filter { PixelBuffers.luma(out, x: $0, y: 900) > 40 }
        let ratio = Double(span.count) / 1080.0
        #expect(abs(ratio - 720.0 / 1280.0) < 0.01, "measured \(span.count) px wide")
    }

    @Test func aSmallerPictureIsCountedUpscaledAndAMatchingOneIsNot() throws {
        let c = try FrameComposer(output: .fullHD)
        _ = try c.compose(try TestPatterns.marked(width: 1280, height: 720), quarterTurns: 0)
        _ = try c.compose(try TestPatterns.marked(width: 1920, height: 1080), quarterTurns: 0)
        #expect(c.composed == 2 && c.upscaled == 1)
    }

    @Test func theScalerFitsBetweenPublishedFormatsAndPassesAMatchThrough() throws {
        let s = try FrameScaler()
        let full = try TestPatterns.marked(width: 1920, height: 1080)
        #expect(try s.fit(full, to: .fullHD) === full)
        let hd = try s.fit(full, to: .hd)
        #expect(CVPixelBufferGetWidth(hd) == 1280 && CVPixelBufferGetHeight(hd) == 720)
        #expect(MARK.contains(PixelBuffers.meanLuma(hd, x: 100, y: 100, w: 200, h: 100)))
    }
}

@Suite struct Cards {
    @Test(arguments: PublishedFormat.all)
    func eachCardRendersTextAndIsCachedPristine(format: PublishedFormat) throws {
        let cards = PlaceholderCards()
        let off = try cards.buffer(.cameraOff, format: format)
        let paused = try cards.buffer(.videoPaused, format: format)
        #expect(CVPixelBufferGetWidth(off) == format.width && CVPixelBufferGetHeight(off) == format.height)
        #expect(CVPixelBufferGetPixelFormatType(off) == PublishedFormat.pixelFormat)
        #expect(PixelBuffers.isIOSurfaceBacked(off))
        // The control that text was actually drawn: bright pixels exist on a dark ground.
        let row = format.height / 2
        let bright = (0..<format.width).filter { PixelBuffers.luma(off, x: $0, y: row) > 120 }.count
        #expect(bright > 20, "no text on the centre row")
        #expect(PixelBuffers.meanLuma(off, x: 0, y: 0, w: 100, h: 100) < 40)
        #expect(PixelBuffers.digest(off) != PixelBuffers.digest(paused))
        #expect(try cards.buffer(.cameraOff, format: format) === off)
        #expect(cards.renders == 2)
    }

    @Test func cardTextNamesNoPhoneNoPersonNoNetwork() {
        for c in Card.allCases {
            #expect(c.text.hasPrefix("Sidekick Camera — "))
            for word in ["phone", "Samsung", "Wi-Fi", "network", "live", "Chetan"] {
                #expect(!c.text.localizedCaseInsensitiveContains(word), "\(c): \(word)")
            }
        }
    }
}

@Suite struct Queueing {
    func sample(_ y: UInt8) throws -> CMSampleBuffer {
        try SampleBuffers.make(try TestPatterns.flat(width: 1280, height: 720, y: y), pts: CMTime(value: Int64(y), timescale: 1))
    }

    @Test func theSinkQueueIsARealBoundedCMSimpleQueueAndTheNewestWins() throws {
        let q = SinkQueue(capacity: 3)
        for y in UInt8(20)..<30 { #expect(q.enqueueLatest(try sample(y))) }
        #expect(q.count == 3 && q.enqueued == 10 && q.supersededSink == 7)
        let left = (0..<3).compactMap { _ in q.dequeue() }.map { CMSampleBufferGetPresentationTimeStamp($0).value }
        #expect(left == [27, 28, 29])
        #expect(q.dequeue() == nil)
    }

    @Test func flushReleasesEverythingQueued() throws {
        let q = SinkQueue(capacity: 3)
        for y in UInt8(20)..<23 { q.enqueueLatest(try sample(y)) }
        q.flush()
        #expect(q.count == 0 && q.flushed == 3)
    }

    @Test func sessionTagsRideOnTheSampleBuffer() throws {
        let sb = try sample(40)
        #expect(SampleBuffers.tags(sb) == nil)
        let id = SessionID(hex: "abcdefabcdefabcdefabcdefabcdefab")!
        SampleBuffers.tag(sb, session: id, generation: 9)
        let t = SampleBuffers.tags(sb)
        #expect(t?.0 == id && t?.1 == 9)
    }
}
