import { Test, TestingModule } from '@nestjs/testing';
import { MediaImageService } from './media-image.service';
import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';

jest.mock('sharp');

describe('MediaImageService', () => {
  let service: MediaImageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaImageService],
    }).compile();

    service = module.get<MediaImageService>(MediaImageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processImage', () => {
    let mockSharpInstance: any;

    beforeEach(() => {
      mockSharpInstance = {
        metadata: jest.fn(),
        clone: jest.fn().mockReturnThis(),
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn(),
      };
      (sharp as unknown as jest.Mock).mockReturnValue(mockSharpInstance);
    });

    it('should return buffer when image is valid and no processing needed', async () => {
      // Arrange
      const buffer = Buffer.from('test');
      mockSharpInstance.metadata.mockResolvedValue({
        width: 1080,
        height: 1440,
        format: 'jpeg',
      });

      // Act
      const result = await service.processImage(buffer, false, false);

      // Assert
      expect(result.buffer).toBe(buffer);
    });

    it('should throw BadRequestException when aspect ratio is invalid', async () => {
      // Arrange
      const buffer = Buffer.from('test');
      mockSharpInstance.metadata.mockResolvedValue({
        width: 100,
        height: 100,
        format: 'jpeg',
      }); // 1:1 ratio

      // Act & Assert
      await expect(service.processImage(buffer, true, false)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should crop image when cropToRatio is true', async () => {
      // Arrange
      const buffer = Buffer.from('test');
      const croppedBuffer = Buffer.from('cropped');
      mockSharpInstance.metadata.mockResolvedValue({
        width: 2000,
        height: 2000,
        format: 'png',
      });
      mockSharpInstance.toBuffer.mockResolvedValue(croppedBuffer);

      // Act
      const result = await service.processImage(buffer, false, true);

      // Assert
      expect(result.buffer).toBe(croppedBuffer);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith({
        width: 1080,
        height: 1440,
        fit: 'cover',
      });
    });

    it('should resize image when width > 1080', async () => {
      // Arrange
      const buffer = Buffer.from('test');
      const resizedBuffer = Buffer.from('resized');
      mockSharpInstance.metadata.mockResolvedValue({
        width: 2000,
        height: 2000,
        format: 'png',
      });
      mockSharpInstance.toBuffer.mockResolvedValue(resizedBuffer);

      // Act
      const result = await service.processImage(buffer, false, false);

      // Assert
      expect(result.buffer).toBe(resizedBuffer);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith({ width: 1080 });
    });

    it('should not resize image when width <= 1080', async () => {
      // Arrange
      const buffer = Buffer.from('test');
      const resizedBuffer = Buffer.from('resized');
      mockSharpInstance.metadata.mockResolvedValue({
        width: 1000,
        height: 1000,
        format: 'png',
      });
      mockSharpInstance.toBuffer.mockResolvedValue(resizedBuffer);

      // Act
      const result = await service.processImage(buffer, false, false);

      // Assert
      expect(result.buffer).toBe(resizedBuffer);
      expect(mockSharpInstance.resize).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when sharp fails', async () => {
      // Arrange
      mockSharpInstance.metadata.mockRejectedValue(new Error('Sharp error'));

      // Act & Assert
      await expect(
        service.processImage(Buffer.from('test'), false, false),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
