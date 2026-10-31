import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GetHashtagMentionExtraDataByHashtagService } from './GetHashtagMentionExtraDataByHashtag.Service';
import { TattooDetailsHasHashtag } from 'model/hashtag/TattooHasHashtag.entity';
import { QtPhotosInHashtagService } from 'modules/hashtags/QtPhotosInHashtag.Service';
import { GetTattooPhotosService } from 'modules/tattoo/GetTattooPhotos.Service';
import { Hashtag } from 'model/hashtag/Hashtag.entity';

describe('GetHashtagMentionExtraDataByHashtagService', () => {
  let service: GetHashtagMentionExtraDataByHashtagService;
  let qbMock: any;
  let tattooHasHashtagRepository: any;
  let qtPhotosInHashtagService: any;
  let getTattooPhotosService: any;

  beforeEach(async () => {
    qbMock = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    tattooHasHashtagRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    };

    qtPhotosInHashtagService = {
      call: jest.fn(),
    };

    getTattooPhotosService = {
      getByTattooId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetHashtagMentionExtraDataByHashtagService,
        {
          provide: getRepositoryToken(TattooDetailsHasHashtag),
          useValue: tattooHasHashtagRepository,
        },
        {
          provide: QtPhotosInHashtagService,
          useValue: qtPhotosInHashtagService,
        },
        {
          provide: GetTattooPhotosService,
          useValue: getTattooPhotosService,
        },
      ],
    }).compile();

    service = module.get<GetHashtagMentionExtraDataByHashtagService>(
      GetHashtagMentionExtraDataByHashtagService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('call', () => {
    const mockHashtag: Hashtag = {
      id: 10,
      name: 'blackwork',
    } as any;

    it('should return HashtagMentionDto with photo url when interaction and photos exist', async () => {
      const mockInteraction = {
        tattooDetails: {
          tattoo: {
            id: 'tattoo-99',
          },
        },
      };
      qbMock.getOne.mockResolvedValueOnce(mockInteraction);
      qtPhotosInHashtagService.call.mockResolvedValueOnce(15);
      getTattooPhotosService.getByTattooId.mockResolvedValueOnce([
        { media: { url: 'https://cdn.tattoopop.com/photo1.jpg' } },
      ]);

      const result = await service.call('user-1', mockHashtag);

      expect(result).toBeDefined();
      expect(result.display).toBe('blackwork');
      expect(result.qtTattoos).toBe(15);
      expect(result.tattooUrl).toBe('https://cdn.tattoopop.com/photo1.jpg');
      expect(result.tattooId).toBe('tattoo-99');
      expect(result.hashtagId).toBe(10 as any);
      expect(tattooHasHashtagRepository.createQueryBuilder).toHaveBeenCalledWith('tattoo_has_hashtag');
      expect(qbMock.where).toHaveBeenCalledWith('hashtag.id = :id', { id: 10 });
      expect(qtPhotosInHashtagService.call).toHaveBeenCalledWith(10);
      expect(getTattooPhotosService.getByTattooId).toHaveBeenCalledWith('user-1', 'tattoo-99');
    });

    it('should return HashtagMentionDto with null mediaUrl when photos array is empty', async () => {
      const mockInteraction = {
        tattooDetails: {
          tattoo: {
            id: 'tattoo-99',
          },
        },
      };
      qbMock.getOne.mockResolvedValueOnce(mockInteraction);
      qtPhotosInHashtagService.call.mockResolvedValueOnce(0);
      getTattooPhotosService.getByTattooId.mockResolvedValueOnce([]);

      const result = await service.call('user-1', mockHashtag);

      expect(result).toBeDefined();
      expect(result.tattooUrl).toBeNull();
      expect(result.qtTattoos).toBe(0);
    });

    it('should propagate error if qtPhotosInHashtagService throws', async () => {
      const mockInteraction = {
        tattooDetails: {
          tattoo: {
            id: 'tattoo-99',
          },
        },
      };
      qbMock.getOne.mockResolvedValueOnce(mockInteraction);
      qtPhotosInHashtagService.call.mockRejectedValueOnce(new Error('DB failure'));

      await expect(service.call('user-1', mockHashtag)).rejects.toThrow('DB failure');
    });
  });
});
