import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { QrCodeService } from './QrCode.Service';
import { Budget } from 'model/budget/Budget.entity';
import { Artist } from 'model/users/Artist.entity';

describe('QrCodeService', () => {
  let service: QrCodeService;
  let budgetRepository: any;
  let artistRepository: any;

  beforeEach(async () => {
    budgetRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
    };

    artistRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrCodeService,
        {
          provide: getRepositoryToken(Budget),
          useValue: budgetRepository,
        },
        {
          provide: getRepositoryToken(Artist),
          useValue: artistRepository,
        },
      ],
    }).compile();

    service = module.get<QrCodeService>(QrCodeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    it('should update budget with generated qrCode uuid', async () => {
      await service.generate('budget-123');

      expect(budgetRepository.update).toHaveBeenCalledWith(
        { id: 'budget-123' },
        { qrCode: expect.any(String) },
      );
    });
  });

  describe('validate', () => {
    it('should throw UnauthorizedException when artist id does not match budget selectedArtist id', async () => {
      artistRepository.findOne.mockResolvedValueOnce({ id: 'artist-1' });
      budgetRepository.findOne.mockResolvedValueOnce({
        id: 'budget-1',
        qrCode: 'valid-qr',
        selectedArtist: { id: 'artist-2' },
      });

      await expect(
        service.validate('artist-1', 'budget-1', 'valid-qr'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return true when artist matches and qrCode is valid', async () => {
      artistRepository.findOne.mockResolvedValueOnce({ id: 'artist-1' });
      budgetRepository.findOne.mockResolvedValueOnce({
        id: 'budget-1',
        qrCode: 'valid-qr',
        selectedArtist: { id: 'artist-1' },
      });

      const result = await service.validate('artist-1', 'budget-1', 'valid-qr');

      expect(result).toBe(true);
      expect(budgetRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'budget-1' },
        select: ['id', 'qrCode', 'selectedArtist'],
        relations: ['selectedArtist'],
      });
    });

    it('should return false when artist matches but qrCode does not match', async () => {
      artistRepository.findOne.mockResolvedValueOnce({ id: 'artist-1' });
      budgetRepository.findOne.mockResolvedValueOnce({
        id: 'budget-1',
        qrCode: 'valid-qr',
        selectedArtist: { id: 'artist-1' },
      });

      const result = await service.validate('artist-1', 'budget-1', 'wrong-qr');

      expect(result).toBe(false);
    });
  });
});
