import CoreMedia
import CoreVideo
import WebcamCore

public enum SampleBufferError: Error, Equatable {
    case format(OSStatus)
    case create(OSStatus)
}

/// `CMSampleBuffer`s around composed frames, tagged with their session on the way into the sink.
///
/// The tags are **defence in depth**. Whether `CMSampleBuffer` attachments survive CoreMediaIO's sink
/// queue between processes is unread (proposal Q7). The design does not depend on them, because the
/// sink stream's start and stop bound a session on their own.
public enum SampleBuffers {
    public static func make(_ pb: CVPixelBuffer, pts: CMTime, duration: CMTime = .invalid) throws -> CMSampleBuffer {
        var fd: CMVideoFormatDescription?
        var st = CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault,
                                                              imageBuffer: pb, formatDescriptionOut: &fd)
        guard st == noErr, let fd else { throw SampleBufferError.format(st) }
        var timing = CMSampleTimingInfo(duration: duration, presentationTimeStamp: pts, decodeTimeStamp: .invalid)
        var sb: CMSampleBuffer?
        st = CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pb,
                                                      formatDescription: fd, sampleTiming: &timing,
                                                      sampleBufferOut: &sb)
        guard st == noErr, let sb else { throw SampleBufferError.create(st) }
        return sb
    }

    public static func tag(_ sb: CMSampleBuffer, session: SessionID, generation: UInt16) {
        CMSetAttachment(sb, key: SidekickCameraIdentity.sessionAttachmentKey as CFString,
                        value: session.hex as CFString, attachmentMode: kCMAttachmentMode_ShouldPropagate)
        CMSetAttachment(sb, key: SidekickCameraIdentity.generationAttachmentKey as CFString,
                        value: NSNumber(value: generation), attachmentMode: kCMAttachmentMode_ShouldPropagate)
    }

    public static func tags(_ sb: CMSampleBuffer) -> (SessionID, UInt16)? {
        guard let s = CMGetAttachment(sb, key: SidekickCameraIdentity.sessionAttachmentKey as CFString,
                                      attachmentModeOut: nil) as? String,
              let id = SessionID(hex: s),
              let g = CMGetAttachment(sb, key: SidekickCameraIdentity.generationAttachmentKey as CFString,
                                      attachmentModeOut: nil) as? NSNumber else { return nil }
        return (id, g.uint16Value)
    }
}
