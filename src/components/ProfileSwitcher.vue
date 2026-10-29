<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { useFamilies, useProfiles } from "@/composables/useConvex";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, Check } from "lucide-vue-next";

const auth = useAuthStore();
const router = useRouter();
const { profiles } = useProfiles();
const { families } = useFamilies();

const profileColor = (profile: any) => profile?.avatarColor || "#6B7280";
const userEmailById = computed(() => {
  const map = new Map<string, string>();
  for (const family of families.value || []) {
    for (const member of family.members || []) {
      if (member.userId && member.email) {
        map.set(member.userId, member.email);
      }
    }
  }
  return map;
});

const profileName = (profile: any) => {
  if (!profile) return "Select Profile";
  if (profile.isDefault && profile.userId === auth.userId) return "Me";
  const knownEmail = userEmailById.value.get(profile.userId);
  if (knownEmail) return knownEmail;
  return profile.name || "Profile";
};

const triggerProfileName = (profile: any) => {
  if (!profile) return "Select Profile";
  // In the sidebar trigger, always label your own profile as Me.
  if (profile.userId === auth.userId) return "Me";
  return profileName(profile);
};

const profileInitial = (profile: any) => {
  const label = triggerProfileName(profile);
  return label[0]?.toUpperCase() || "?";
};

const currentProfile = computed(() => {
  if (!profiles.value || !auth.profileId) return null;
  return profiles.value.find((p) => p._id === auth.profileId);
});

const groupedProfiles = computed(() => {
  if (!profiles.value) return [];
  const userFamily = new Map<string, string>();
  for (const family of families.value || []) {
    for (const member of family.members || []) {
      if (!userFamily.has(member.userId)) {
        userFamily.set(member.userId, family.name);
      }
    }
  }

  const groups = new Map<string, typeof profiles.value>();
  for (const profile of profiles.value) {
    const groupName = userFamily.get(profile.userId) || "Personal";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push(profile);
  }

  const ordered = Array.from(groups.entries()).map(([name, groupProfiles]) => ({
    name,
    profiles: groupProfiles,
  }));
  return ordered.sort((a, b) => {
    if (a.name === "Personal") return -1;
    if (b.name === "Personal") return 1;
    return a.name.localeCompare(b.name);
  });
});

const switchProfile = (profileId: string) => {
  auth.setActiveProfile(profileId as any);
};

</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger
      class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors w-full min-w-0"
    >
      <div
        class="h-8 w-8 shrink-0 rounded-full border border-black/10 flex items-center justify-center text-white text-sm font-semibold leading-none"
        :style="{ backgroundColor: profileColor(currentProfile) }"
      >
        {{ profileInitial(currentProfile) }}
      </div>
      <span class="flex-1 min-w-0 text-left font-medium truncate">
        {{ triggerProfileName(currentProfile) }}
      </span>
      <ChevronDown class="h-4 w-4 text-muted-foreground" />
    </DropdownMenuTrigger>

    <DropdownMenuContent align="start" class="w-64">
      <DropdownMenuLabel>Switch Profile</DropdownMenuLabel>
      <DropdownMenuSeparator />

      <template v-for="group in groupedProfiles" :key="group.name">
        <DropdownMenuLabel class="text-xs text-muted-foreground px-2 py-1.5">
          {{ group.name }}
        </DropdownMenuLabel>
        <DropdownMenuItem
          v-for="profile in group.profiles"
          :key="profile._id"
          class="flex items-center gap-2 cursor-pointer"
          @click="switchProfile(profile._id)"
        >
          <div
            class="h-6 w-6 shrink-0 rounded-full border border-black/10 flex items-center justify-center text-white text-xs font-semibold leading-none"
            :style="{ backgroundColor: profileColor(profile) }"
          >
            {{ profileInitial(profile) }}
          </div>
          <span class="flex-1 truncate">{{ profileName(profile) }}</span>
          <Check v-if="profile._id === auth.profileId" class="h-4 w-4 text-primary" />
        </DropdownMenuItem>
      </template>

      <DropdownMenuSeparator />

      <DropdownMenuItem
        class="flex items-center gap-2 cursor-pointer"
        @click="router.push('/family')"
      >
        <div
          class="w-6 h-6 rounded-full bg-muted flex items-center justify-center"
        >
          <Plus class="h-3 w-3" />
        </div>
        <span>Manage Family</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
