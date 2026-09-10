import AVFoundation
import CoreVideo
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
  fputs("Usage: swift generate-webinar-fixture.swift OUTPUT.mp4\n", stderr)
  exit(2)
}

let outputURL = URL(fileURLWithPath: arguments[1])
try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let width = 640
let height = 360
let framesPerSecond: Int32 = 10
let durationSeconds = 40
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 120_000],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
])
guard writer.canAdd(input) else { throw NSError(domain: "fixture", code: 1) }
writer.add(input)
guard writer.startWriting() else { throw writer.error ?? NSError(domain: "fixture", code: 2) }
writer.startSession(atSourceTime: .zero)

let totalFrames = durationSeconds * Int(framesPerSecond)
for frame in 0..<totalFrames {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  var pixelBuffer: CVPixelBuffer?
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, [
    kCVPixelBufferCGImageCompatibilityKey: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey: true,
  ] as CFDictionary, &pixelBuffer)
  guard let buffer = pixelBuffer else { throw NSError(domain: "fixture", code: 3) }
  CVPixelBufferLockBaseAddress(buffer, [])
  let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
  let pixels = CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to: UInt8.self)
  let progressX = Int(Double(width - 80) * Double(frame) / Double(totalFrames - 1)) + 40
  for y in 0..<height {
    for x in 0..<width {
      let offset = y * bytesPerRow + x * 4
      let inProgress = y >= 292 && y < 308 && x >= 40 && x <= progressX
      pixels[offset] = inProgress ? 92 : 29
      pixels[offset + 1] = inProgress ? 179 : 38
      pixels[offset + 2] = inProgress ? 222 : 34
      pixels[offset + 3] = 255
    }
  }
  CVPixelBufferUnlockBaseAddress(buffer, [])
  let time = CMTime(value: Int64(frame), timescale: framesPerSecond)
  guard adaptor.append(buffer, withPresentationTime: time) else { throw writer.error ?? NSError(domain: "fixture", code: 4) }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else { throw writer.error ?? NSError(domain: "fixture", code: 5) }
