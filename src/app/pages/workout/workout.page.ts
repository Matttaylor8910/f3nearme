import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BeatdownService } from '../../services/beatdown.service';
import { Beatdown } from '../nearby/nearby.page';

@Component({
  selector: 'app-workout',
  templateUrl: './workout.page.html',
  styleUrls: ['./workout.page.scss']
})
export class WorkoutPage implements OnInit {
  workout: Beatdown;
  relatedWorkouts: Beatdown[] = [];
  mapUrl: string;
  directionsUrl: string;
  loading = true;
  error = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private beatdownService: BeatdownService
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = true;
      this.loading = false;
      return;
    }

    this.beatdownService.getBeatdown(id).subscribe({
      next: (workout) => {
        this.workout = workout;
        this.mapUrl = `https://maps.google.com/maps?q=${workout.lat},${workout.long}&t=m&z=15&output=embed`;
        this.directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${workout.lat},${workout.long}`;
        this.loadRelatedWorkouts();
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading workout:', err);
        this.error = true;
        this.loading = false;
      }
    });
  }

  private loadRelatedWorkouts() {
    if (!this.workout) return;

    this.beatdownService.getBeatdownsByAddress(this.workout.address).subscribe({
      next: (workouts) => {
        // Filter out the current workout and sort by day
        this.relatedWorkouts = workouts
          .filter(w => w.name !== this.workout.name)
          .sort((a, b) => {
            const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            return days.indexOf(a.dayOfWeek) - days.indexOf(b.dayOfWeek);
          });
      },
      error: (err) => {
        console.error('Error loading related workouts:', err);
      }
    });
  }

  openWebsite() {
    if (this.workout.website) {
      window.open(this.workout.website, '_blank');
    }
  }

  openDirections() {
    window.open(this.directionsUrl, '_blank');
  }

  openMap() {
    window.open(this.mapUrl, '_blank');
  }
} 