export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      academic_profiles: {
        Row: {
          catalog_year: number;
          college_id: string;
          program_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          catalog_year: number;
          college_id: string;
          program_id: string;
          user_id: string;
        };
        Update: {
          catalog_year?: number;
          college_id?: string;
          program_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "academic_profiles_program_id_college_id_catalog_year_fkey";
            columns: ["program_id", "college_id", "catalog_year"];
            isOneToOne: false;
            referencedRelation: "academic_programs";
            referencedColumns: ["id", "college_id", "catalog_year"];
          },
        ];
      };
      academic_programs: {
        Row: {
          catalog_year: number;
          college_id: string;
          id: string;
          label: string;
        };
        ComputedFields: never;
        Insert: {
          catalog_year: number;
          college_id: string;
          id?: string;
          label: string;
        };
        Update: {
          catalog_year?: number;
          college_id?: string;
          id?: string;
          label?: string;
        };
        Relationships: [
          {
            foreignKeyName: "academic_programs_college_id_fkey";
            columns: ["college_id"];
            isOneToOne: false;
            referencedRelation: "colleges";
            referencedColumns: ["id"];
          },
        ];
      };
      buildings: {
        Row: {
          id: string;
          name: string | null;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          name?: string | null;
        };
        Update: {
          id?: string;
          name?: string | null;
        };
        Relationships: [];
      };
      chat_memberships: {
        Row: {
          alias: string;
          joined_at: string;
          room_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          alias?: string;
          joined_at?: string;
          room_id: string;
          user_id: string;
        };
        Update: {
          alias?: string;
          joined_at?: string;
          room_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_memberships_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "chat_rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          alias: string;
          body: string;
          created_at: string;
          id: string;
          room_id: string;
        };
        ComputedFields: never;
        Insert: {
          alias: string;
          body: string;
          created_at?: string;
          id?: string;
          room_id: string;
        };
        Update: {
          alias?: string;
          body?: string;
          created_at?: string;
          id?: string;
          room_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_room_id_alias_fkey";
            columns: ["room_id", "alias"];
            isOneToOne: false;
            referencedRelation: "chat_memberships";
            referencedColumns: ["room_id", "alias"];
          },
        ];
      };
      chat_reports: {
        Row: {
          created_at: string;
          id: string;
          message_id: string;
          reason: string;
          reporter_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          message_id: string;
          reason: string;
          reporter_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          message_id?: string;
          reason?: string;
          reporter_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "chat_reports_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_rooms: {
        Row: {
          course_id: string;
          id: string;
          term: string;
        };
        ComputedFields: never;
        Insert: {
          course_id: string;
          id?: string;
          term: string;
        };
        Update: {
          course_id?: string;
          id?: string;
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_rooms_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_rooms_term_fkey";
            columns: ["term"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      colleges: {
        Row: {
          id: string;
          label: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          label: string;
        };
        Update: {
          id?: string;
          label?: string;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          post_id: string;
          public_alias: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string;
          body: string;
          created_at?: string;
          id?: string;
          post_id: string;
          public_alias?: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          post_id?: string;
          public_alias?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "community_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      course_grade_stats: {
        Row: {
          a_ab_count: number;
          a_ab_rate: number | null;
          course_id: string;
          fetched_at: string;
          first_term_code: string;
          last_term_code: string;
          sample_size: number;
          source_url: string;
        };
        ComputedFields: never;
        Insert: {
          a_ab_count: number;
          a_ab_rate?: never;
          course_id: string;
          fetched_at: string;
          first_term_code: string;
          last_term_code: string;
          sample_size: number;
          source_url: string;
        };
        Update: {
          a_ab_count?: number;
          a_ab_rate?: never;
          course_id?: string;
          fetched_at?: string;
          first_term_code?: string;
          last_term_code?: string;
          sample_size?: number;
          source_url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_grade_stats_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: true;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      course_requisites: {
        Row: {
          advisory_requisites: string | null;
          course_id: string;
          enrollment_requisites: string | null;
          fetched_at: string;
          requirement_groups: Json | null;
          source_url: string;
          term: string;
        };
        ComputedFields: never;
        Insert: {
          advisory_requisites?: string | null;
          course_id: string;
          enrollment_requisites?: string | null;
          fetched_at: string;
          requirement_groups?: Json | null;
          source_url: string;
          term: string;
        };
        Update: {
          advisory_requisites?: string | null;
          course_id?: string;
          enrollment_requisites?: string | null;
          fetched_at?: string;
          requirement_groups?: Json | null;
          source_url?: string;
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_requisites_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "course_requisites_term_fkey";
            columns: ["term"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          breadth: string[] | null;
          code: string;
          credit_options: number[];
          fetched_at: string | null;
          id: string;
          repeatable: boolean;
          source: string;
          title: string | null;
        };
        ComputedFields: never;
        Insert: {
          breadth?: string[] | null;
          code: string;
          credit_options: number[];
          fetched_at?: string | null;
          id: string;
          repeatable: boolean;
          source: string;
          title?: string | null;
        };
        Update: {
          breadth?: string[] | null;
          code?: string;
          credit_options?: number[];
          fetched_at?: string | null;
          id?: string;
          repeatable?: boolean;
          source?: string;
          title?: string | null;
        };
        Relationships: [];
      };
      degree_progress: {
        Row: {
          credits_remaining: number | null;
          program_id: string;
          requirement_id: string;
          review_status: Database["public"]["Enums"]["degree_review_status"];
          source: Database["public"]["Enums"]["academic_data_source"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          credits_remaining?: number | null;
          program_id: string;
          requirement_id: string;
          review_status?: Database["public"]["Enums"]["degree_review_status"];
          source?: Database["public"]["Enums"]["academic_data_source"];
          user_id: string;
        };
        Update: {
          credits_remaining?: number | null;
          program_id?: string;
          requirement_id?: string;
          review_status?: Database["public"]["Enums"]["degree_review_status"];
          source?: Database["public"]["Enums"]["academic_data_source"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "degree_progress_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "academic_programs";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          blocked_by: string | null;
          receiver_id: string;
          requester_id: string;
          status: Database["public"]["Enums"]["friendship_status"];
        };
        ComputedFields: never;
        Insert: {
          blocked_by?: string | null;
          receiver_id: string;
          requester_id: string;
          status?: Database["public"]["Enums"]["friendship_status"];
        };
        Update: {
          blocked_by?: string | null;
          receiver_id?: string;
          requester_id?: string;
          status?: Database["public"]["Enums"]["friendship_status"];
        };
        Relationships: [];
      };
      grade_entries: {
        Row: {
          is_final: boolean;
          letter_grade: Database["public"]["Enums"]["letter_grade"] | null;
          record_id: string;
        };
        ComputedFields: never;
        Insert: {
          is_final?: boolean;
          letter_grade?: Database["public"]["Enums"]["letter_grade"] | null;
          record_id: string;
        };
        Update: {
          is_final?: boolean;
          letter_grade?: Database["public"]["Enums"]["letter_grade"] | null;
          record_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "grade_entries_record_id_fkey";
            columns: ["record_id"];
            isOneToOne: true;
            referencedRelation: "user_course_records";
            referencedColumns: ["id"];
          },
        ];
      };
      meetings: {
        Row: {
          building_id: string | null;
          bundle_id: string;
          course_id: string;
          day: Database["public"]["Enums"]["meeting_day"];
          end_min: number;
          id: string;
          mode: Database["public"]["Enums"]["meeting_mode"];
          start_min: number;
          term: string;
        };
        ComputedFields: never;
        Insert: {
          building_id?: string | null;
          bundle_id: string;
          course_id: string;
          day: Database["public"]["Enums"]["meeting_day"];
          end_min: number;
          id?: string;
          mode: Database["public"]["Enums"]["meeting_mode"];
          start_min: number;
          term: string;
        };
        Update: {
          building_id?: string | null;
          bundle_id?: string;
          course_id?: string;
          day?: Database["public"]["Enums"]["meeting_day"];
          end_min?: number;
          id?: string;
          mode?: Database["public"]["Enums"]["meeting_mode"];
          start_min?: number;
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meetings_building_id_fkey";
            columns: ["building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meetings_term_course_id_bundle_id_fkey";
            columns: ["term", "course_id", "bundle_id"];
            isOneToOne: false;
            referencedRelation: "section_bundles";
            referencedColumns: ["term", "course_id", "bundle_id"];
          },
        ];
      };
      post_reports: {
        Row: {
          created_at: string;
          id: string;
          post_id: string;
          reason: string;
          reporter_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          post_id: string;
          reason: string;
          reporter_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          post_id?: string;
          reason?: string;
          reporter_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "post_reports_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "community_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_reports_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          author_id: string;
          body: string;
          category: string;
          course_id: string | null;
          created_at: string;
          id: string;
          public_alias: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string;
          body: string;
          category: string;
          course_id?: string | null;
          created_at?: string;
          id?: string;
          public_alias?: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          category?: string;
          course_id?: string | null;
          created_at?: string;
          id?: string;
          public_alias?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_schedule_items: {
        Row: {
          bundle_id: string;
          course_id: string;
          credits: number;
          schedule_id: string;
          term: string;
        };
        ComputedFields: never;
        Insert: {
          bundle_id: string;
          course_id: string;
          credits: number;
          schedule_id: string;
          term: string;
        };
        Update: {
          bundle_id?: string;
          course_id?: string;
          credits?: number;
          schedule_id?: string;
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_schedule_items_schedule_id_term_fkey";
            columns: ["schedule_id", "term"];
            isOneToOne: false;
            referencedRelation: "saved_schedules";
            referencedColumns: ["id", "term"];
          },
          {
            foreignKeyName: "saved_schedule_items_term_course_id_bundle_id_fkey";
            columns: ["term", "course_id", "bundle_id"];
            isOneToOne: false;
            referencedRelation: "section_bundles";
            referencedColumns: ["term", "course_id", "bundle_id"];
          },
        ];
      };
      saved_schedules: {
        Row: {
          id: string;
          mode: Database["public"]["Enums"]["schedule_mode"];
          name: string;
          source_request_id: string | null;
          term: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          mode: Database["public"]["Enums"]["schedule_mode"];
          name: string;
          source_request_id?: string | null;
          term: string;
          user_id: string;
        };
        Update: {
          id?: string;
          mode?: Database["public"]["Enums"]["schedule_mode"];
          name?: string;
          source_request_id?: string | null;
          term?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_schedules_term_fkey";
            columns: ["term"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      schedule_permissions: {
        Row: {
          owner_id: string;
          viewer_id: string;
          visibility: Database["public"]["Enums"]["visibility"];
        };
        ComputedFields: never;
        Insert: {
          owner_id: string;
          viewer_id: string;
          visibility?: Database["public"]["Enums"]["visibility"];
        };
        Update: {
          owner_id?: string;
          viewer_id?: string;
          visibility?: Database["public"]["Enums"]["visibility"];
        };
        Relationships: [];
      };
      section_bundles: {
        Row: {
          bundle_id: string;
          course_id: string;
          instructor_score: number | null;
          seat_status: Database["public"]["Enums"]["seat_status"];
          term: string;
        };
        ComputedFields: never;
        Insert: {
          bundle_id: string;
          course_id: string;
          instructor_score?: number | null;
          seat_status?: Database["public"]["Enums"]["seat_status"];
          term: string;
        };
        Update: {
          bundle_id?: string;
          course_id?: string;
          instructor_score?: number | null;
          seat_status?: Database["public"]["Enums"]["seat_status"];
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: "section_bundles_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "section_bundles_term_fkey";
            columns: ["term"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      terms: {
        Row: {
          id: string;
          is_current: boolean;
          label: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          is_current?: boolean;
          label: string;
        };
        Update: {
          id?: string;
          is_current?: boolean;
          label?: string;
        };
        Relationships: [];
      };
      user_blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_id: string;
          blocker_id?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
        };
        Relationships: [];
      };
      user_course_records: {
        Row: {
          bundle_id: string | null;
          counts_toward_major: boolean;
          course_id: string;
          credits: number;
          id: string;
          source: Database["public"]["Enums"]["academic_data_source"];
          status: Database["public"]["Enums"]["course_record_status"];
          term: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          bundle_id?: string | null;
          counts_toward_major?: boolean;
          course_id: string;
          credits: number;
          id?: string;
          source?: Database["public"]["Enums"]["academic_data_source"];
          status: Database["public"]["Enums"]["course_record_status"];
          term: string;
          user_id: string;
        };
        Update: {
          bundle_id?: string | null;
          counts_toward_major?: boolean;
          course_id?: string;
          credits?: number;
          id?: string;
          source?: Database["public"]["Enums"]["academic_data_source"];
          status?: Database["public"]["Enums"]["course_record_status"];
          term?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_course_records_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_course_records_term_course_id_bundle_id_fkey";
            columns: ["term", "course_id", "bundle_id"];
            isOneToOne: false;
            referencedRelation: "section_bundles";
            referencedColumns: ["term", "course_id", "bundle_id"];
          },
          {
            foreignKeyName: "user_course_records_term_fkey";
            columns: ["term"];
            isOneToOne: false;
            referencedRelation: "terms";
            referencedColumns: ["id"];
          },
        ];
      };
      walking_edges: {
        Row: {
          bidirectional: boolean;
          from_building_id: string;
          minutes: number;
          to_building_id: string;
        };
        ComputedFields: never;
        Insert: {
          bidirectional?: boolean;
          from_building_id: string;
          minutes: number;
          to_building_id: string;
        };
        Update: {
          bidirectional?: boolean;
          from_building_id?: string;
          minutes?: number;
          to_building_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "walking_edges_from_building_id_fkey";
            columns: ["from_building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "walking_edges_to_building_id_fkey";
            columns: ["to_building_id"];
            isOneToOne: false;
            referencedRelation: "buildings";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      community_comments: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          post_id: string;
          public_alias: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          created_at?: string | null;
          id?: string | null;
          post_id?: string | null;
          public_alias?: string | null;
        };
        Update: {
          body?: string | null;
          created_at?: string | null;
          id?: string | null;
          post_id?: string | null;
          public_alias?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "community_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      community_posts: {
        Row: {
          body: string;
          category: string;
          course_id: string | null;
          created_at: string;
          id: string;
          public_alias: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          category?: string | null;
          course_id?: string | null;
          created_at?: string | null;
          id?: string | null;
          public_alias?: string | null;
        };
        Update: {
          body?: string | null;
          category?: string | null;
          course_id?: string | null;
          created_at?: string | null;
          id?: string | null;
          public_alias?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "posts_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      can_view_schedule: {
        Args: { owner: string; viewer: string };
        Returns: boolean;
      };
      is_room_member: { Args: { room_id: string }; Returns: boolean };
      join_chat_room: { Args: { room_id: string }; Returns: string };
      my_chat_rooms: {
        Args: Record<PropertyKey, never>;
        Returns: {
          course_code: string;
          course_id: string;
          my_alias: string;
          participant_count: number;
          room_id: string;
          term: string;
          title: string;
        }[];
      };
      schedule_free_busy: {
        Args: {
          requested_mode: Database["public"]["Enums"]["schedule_mode"];
          schedule_owner: string;
          schedule_term: string;
        };
        Returns: {
          day: Database["public"]["Enums"]["meeting_day"];
          end_min: number;
          start_min: number;
        }[];
      };
      schedule_visibility: {
        Args: { owner: string; viewer: string };
        Returns: Database["public"]["Enums"]["visibility"];
      };
    };
    Enums: {
      academic_data_source: "manual" | "dars_pdf" | "dig";
      course_record_status:
        | "completed"
        | "enrolled_self_reported"
        | "planned"
        | "withdrawn";
      degree_review_status: "manual" | "dars_pdf" | "unverified";
      friendship_status: "pending" | "accepted" | "blocked";
      letter_grade: "A" | "AB" | "B" | "BC" | "C" | "D" | "F";
      meeting_day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
      meeting_mode: "in_person" | "hybrid" | "online_sync";
      schedule_mode: "planned" | "enrolled_self_reported";
      seat_status: "open" | "full" | "unknown";
      visibility: "private" | "free_busy" | "full";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      academic_data_source: ["manual", "dars_pdf", "dig"],
      course_record_status: [
        "completed",
        "enrolled_self_reported",
        "planned",
        "withdrawn",
      ],
      degree_review_status: ["manual", "dars_pdf", "unverified"],
      friendship_status: ["pending", "accepted", "blocked"],
      letter_grade: ["A", "AB", "B", "BC", "C", "D", "F"],
      meeting_day: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
      meeting_mode: ["in_person", "hybrid", "online_sync"],
      schedule_mode: ["planned", "enrolled_self_reported"],
      seat_status: ["open", "full", "unknown"],
      visibility: ["private", "free_busy", "full"],
    },
  },
} as const;
