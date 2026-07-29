export interface VideoQualityConfig {
  resolution: '360p' | '480p' | '720p' | '1080p';
  frameRate: 15 | 24 | 30 | 60;
  bitrate: number;
  codec: 'VP8' | 'VP9' | 'H264';
  adaptiveBitrate: boolean;
}

export interface NetworkQuality {
  bandwidth: number; // kbps
  latency: number; // ms
  packetLoss: number; // percentage
  jitter: number; // ms
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

export class VideoQualityService {
  private readonly QUALITY_THRESHOLDS = {
    excellent: { bandwidth: 2000, latency: 50, packetLoss: 1 },
    good: { bandwidth: 1000, latency: 100, packetLoss: 5 },
    fair: { bandwidth: 500, latency: 200, packetLoss: 10 },
  };

  /**
   * Determine network quality based on current network metrics
   */
  public determineNetworkQuality(metrics: Omit<NetworkQuality, 'quality'>): NetworkQuality {
    let quality: NetworkQuality['quality'] = 'poor';

    if (
      metrics.bandwidth >= this.QUALITY_THRESHOLDS.excellent.bandwidth &&
      metrics.latency <= this.QUALITY_THRESHOLDS.excellent.latency &&
      metrics.packetLoss <= this.QUALITY_THRESHOLDS.excellent.packetLoss
    ) {
      quality = 'excellent';
    } else if (
      metrics.bandwidth >= this.QUALITY_THRESHOLDS.good.bandwidth &&
      metrics.latency <= this.QUALITY_THRESHOLDS.good.latency &&
      metrics.packetLoss <= this.QUALITY_THRESHOLDS.good.packetLoss
    ) {
      quality = 'good';
    } else if (
      metrics.bandwidth >= this.QUALITY_THRESHOLDS.fair.bandwidth &&
      metrics.latency <= this.QUALITY_THRESHOLDS.fair.latency &&
      metrics.packetLoss <= this.QUALITY_THRESHOLDS.fair.packetLoss
    ) {
      quality = 'fair';
    }

    return { ...metrics, quality };
  }

  /**
   * Optimize video configuration based on the detected network quality
   */
  public optimizeVideoQuality(networkQuality: NetworkQuality): VideoQualityConfig {
    const baseConfig: VideoQualityConfig = {
      resolution: '480p',
      frameRate: 30,
      bitrate: 500,
      codec: 'VP8',
      adaptiveBitrate: true,
    };

    switch (networkQuality.quality) {
      case 'excellent':
        return { ...baseConfig, resolution: '1080p', frameRate: 60, bitrate: 2500, codec: 'VP9' };
      case 'good':
        return { ...baseConfig, resolution: '720p', frameRate: 30, bitrate: 1500, codec: 'VP8' };
      case 'fair':
        return { ...baseConfig, resolution: '480p', frameRate: 24, bitrate: 500, codec: 'VP8' };
      case 'poor':
        return { ...baseConfig, resolution: '360p', frameRate: 15, bitrate: 250, codec: 'VP8' };
      default:
        return baseConfig;
    }
  }

  /**
   * Echo cancellation and noise suppression settings
   */
  public getAudioProcessingConfig() {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
  }
}
