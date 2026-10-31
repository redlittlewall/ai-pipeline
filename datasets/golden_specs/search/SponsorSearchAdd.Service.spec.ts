import { Test, TestingModule } from '@nestjs/testing';
import { SponsorSearchAddService } from './SponsorSearchAdd.Service';
import { GetArtistDetailService } from './GetArtistDetail.Service';
import { SponsorsService } from 'modules/sponsors/Sponsors.service';

describe('SponsorSearchAddService', () => {
  let service: SponsorSearchAddService;
  let getArtistDetailService: any;
  let sponsorsService: any;

  beforeEach(async () => {
    getArtistDetailService = {
      getArtistDetails: jest.fn(),
    };
    sponsorsService = {
      getSponsors: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SponsorSearchAddService,
        {
          provide: GetArtistDetailService,
          useValue: getArtistDetailService,
        },
        {
          provide: SponsorsService,
          useValue: sponsorsService,
        },
      ],
    }).compile();

    service = module.get<SponsorSearchAddService>(SponsorSearchAddService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSponsors', () => {
    it('should return list of artist details when sponsors exist', async () => {
      // Given (Arrange)
      const mockSponsors = [
        { artistId: 'artist-1' },
        { artistId: 'artist-2' },
      ] as any;
      const mockDetails = [{ id: 'detail-1' }, { id: 'detail-2' }] as any;

      sponsorsService.getSponsors.mockResolvedValue(mockSponsors);
      getArtistDetailService.getArtistDetails
        .mockResolvedValueOnce(mockDetails[0])
        .mockResolvedValueOnce(mockDetails[1]);

      // When (Act)
      const result = await service.getSponsors('client-1');

      // Then (Assert)
      expect(result).toEqual(mockDetails);
      expect(sponsorsService.getSponsors).toHaveBeenCalled();
      expect(getArtistDetailService.getArtistDetails).toHaveBeenCalledTimes(2);
      expect(getArtistDetailService.getArtistDetails).toHaveBeenCalledWith(
        'client-1',
        'artist-1',
      );
      expect(getArtistDetailService.getArtistDetails).toHaveBeenCalledWith(
        'client-1',
        'artist-2',
      );
    });

    it('should return empty array when no sponsors exist', async () => {
      // Given (Arrange)
      sponsorsService.getSponsors.mockResolvedValue([]);

      // When (Act)
      const result = await service.getSponsors('client-1');

      // Then (Assert)
      expect(result).toEqual([]);
      expect(getArtistDetailService.getArtistDetails).not.toHaveBeenCalled();
    });

    it('should propagate error when sponsorsService fails', async () => {
      // Given (Arrange)
      sponsorsService.getSponsors.mockRejectedValue(
        new Error('Database error'),
      );

      // When & Then (Act & Assert)
      await expect(service.getSponsors('client-1')).rejects.toThrow(
        'Database error',
      );
    });

    it('should propagate error when getArtistDetails fails', async () => {
      // Given (Arrange)
      sponsorsService.getSponsors.mockResolvedValue([
        { artistId: 'artist-1' },
      ] as any);
      getArtistDetailService.getArtistDetails.mockRejectedValue(
        new Error('Service error'),
      );

      // When & Then (Act & Assert)
      await expect(service.getSponsors('client-1')).rejects.toThrow(
        'Service error',
      );
    });
  });
});
