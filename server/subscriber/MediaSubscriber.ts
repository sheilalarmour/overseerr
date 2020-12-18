import {
  EntitySubscriberInterface,
  EventSubscriber,
  getRepository,
  UpdateEvent,
} from 'typeorm';
import TheMovieDb from '../api/themoviedb';
import { MediaStatus, MediaType } from '../constants/media';
import Media from '../entity/Media';
import { MediaRequest } from '../entity/MediaRequest';
import notificationManager, { Notification } from '../lib/notifications';

@EventSubscriber()
export class MediaSubscriber implements EntitySubscriberInterface {
  private async notifyAvailableMovie(entity: Media) {
    if (entity.status === MediaStatus.AVAILABLE) {
      if (entity.mediaType === MediaType.MOVIE) {
        const requestRepository = getRepository(MediaRequest);
        const relatedRequests = await requestRepository.find({
          where: { media: entity },
        });

        if (relatedRequests.length > 0) {
          const tmdb = new TheMovieDb();
          const movie = await tmdb.getMovie({ movieId: entity.tmdbId });

          relatedRequests.forEach((request) => {
            notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
              notifyUser: request.requestedBy,
              subject: movie.title,
              message: movie.overview,
              image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${movie.poster_path}`,
            });
          });
        }
      }
    }
  }

  private async notifyAvailableSeries(entity: Media, dbEntity: Media) {
    const newAvailableSeasons = entity.seasons
      .filter((season) => season.status === MediaStatus.AVAILABLE)
      .map((season) => season.seasonNumber);
    const oldAvailableSeasons = dbEntity.seasons
      .filter((season) => season.status === MediaStatus.AVAILABLE)
      .map((season) => season.seasonNumber);

    const changedSeasons = newAvailableSeasons.filter(
      (seasonNumber) => !oldAvailableSeasons.includes(seasonNumber)
    );

    if (changedSeasons.length > 0) {
      const tmdb = new TheMovieDb();
      const requestRepository = getRepository(MediaRequest);
      const processedSeasons: number[] = [];

      for (const changedSeasonNumber of changedSeasons) {
        const requests = await requestRepository.find({
          where: { media: entity },
        });
        const request = requests.find(
          (request) =>
            // Check if the season is complete AND it contains the current season that was just marked available
            request.seasons.every((season) =>
              newAvailableSeasons.includes(season.seasonNumber)
            ) &&
            request.seasons.some(
              (season) => season.seasonNumber === changedSeasonNumber
            )
        );

        if (request && !processedSeasons.includes(changedSeasonNumber)) {
          processedSeasons.push(
            ...request.seasons.map((season) => season.seasonNumber)
          );
          const tv = await tmdb.getTvShow({ tvId: entity.tmdbId });
          notificationManager.sendNotification(Notification.MEDIA_AVAILABLE, {
            subject: tv.name,
            message: tv.overview,
            notifyUser: request.requestedBy,
            image: `https://image.tmdb.org/t/p/w600_and_h900_bestv2${tv.poster_path}`,
            extra: [
              {
                name: 'Seasons',
                value: request.seasons
                  .map((season) => season.seasonNumber)
                  .join(', '),
              },
            ],
          });
        }
      }
    }
  }

  public beforeUpdate(event: UpdateEvent<Media>): void {
    if (
      event.entity.mediaType === MediaType.MOVIE &&
      event.entity.status === MediaStatus.AVAILABLE
    ) {
      this.notifyAvailableMovie(event.entity);
    }

    if (
      event.entity.mediaType === MediaType.TV &&
      (event.entity.status === MediaStatus.AVAILABLE ||
        event.entity.status === MediaStatus.PARTIALLY_AVAILABLE)
    ) {
      this.notifyAvailableSeries(event.entity, event.databaseEntity);
    }
  }
}